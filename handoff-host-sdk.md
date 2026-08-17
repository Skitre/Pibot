# 交接：把 Bot 脑子从容器 RPC 迁到本机 SDK

把本文件整份交给下一个模型。它是任务说明书，不是闲聊摘要。不要改 Cursor 计划文件。先读代码再动手。Windows / PowerShell。不要 commit，除非用户明确说。服务端改完必须重启 `npm run start --workspace server`（tsx 无 watch，端口 8790；先杀占用再起）。

仓库：`C:\Users\Admin\Desktop\project\pibot`  
当前 `master` 大致在 `fedafce`（群头像扎堆 + 线程改名/描述/拉人踢人）以及更早的 `84d2b85`（浅色主题 + 关电脑）。先 `git log -8 --oneline` 对一下，再开始。

---

## 0. 你是谁、要做成什么

你在继续 **Pibot**：本机单用户版 Grok Bot。

- Web：React 19 + Vite，`web/`，通常 **5190**
- Host：Fastify + SQLite，`server/`，**8790**
- 共享电脑：Docker 容器 `pibot-computer-shared`，镜像 `pibot-computer:latest`，卷 `pibot-computer-data` → `/config`
- 对用户只说「电脑」，不说 box / sandbox

**任务：** 把模型循环（脑子）从容器里的 `pi --mode rpc` 搬到 **本机 Node**，用 `@earendil-works/pi-coding-agent`（`server/package.json` 的 **devDependency** `^0.84.1`，不是 Cursor `@cursor/sdk`）。容器只当电脑。

做成之后必须同时成立：

1. 电脑关掉，1:1 和群聊还能说话。bash / 浏览器 / 截屏不可用时，用可见文字说「电脑离线」，不要报 Bot offline，也不要去 exec。
2. 1:1 与群可以有不同的 system。不要再共用一份 `APPEND_SYSTEM.md`。
3. Host 规则不要再当成用户消息塞进 session jsonl。同一 1:1 连说三句，上下文里不该反复出现整段 Tone / Autonomy。
4. 换提示词不要再靠改 `APPEND_SYSTEM.md` + 重启 pi。
5. SDK **不准**把 Windows 工程目录、用户桌面当 Bot 的电脑。cwd / workspace 必须指向容器里的 `/config/...`，工具经 dockerode 或容器内极薄服务执行。

官方对照（已删 `src_extract/`、`bot-mark-kit/`，**不要去翻、不要再拷**）：官方脑子和 `SendMessage` 在 Host 应用里；box 只是电脑。关掉 box 还能聊。Pibot 现在把 `pi` 塞进容器，所以关电脑 = 所有 Bot 休眠。用户要的是官方这条切法。

---

## 1. 现在怎么跑（拆之前必须看懂）

```
浏览器 :5190
  → Fastify :8790（编排、SQLite、dockerode、WebSocket /ws）
    → ws://127.0.0.1:8900  →  容器 8791  bot-image/opt/pibot/bridge.mjs
         每个 Bot 一个 `pi --mode rpc`
         HOME=/config/bots/<id>
         cwd=/config/bots/<id>
         扩展 /opt/pibot/extensions/pibot.ts
```

端口（`server/src/config.ts`）：

| 用途 | 宿主 | 容器内 |
|---|---|---|
| Fastify | 8790 | — |
| Vite | 5190 | — |
| KasmVNC | 3100 | 3000 |
| RPC 桥 | 8900 | 8791 |
| Chromium CDP | **未映射** | `127.0.0.1:9222` |

容器环境变量：`PIBOT_BRIDGE_PORT=8791`，`PIBOT_WORKSPACE=/config/workspace`，`PUID/PGID=1000`。RestartPolicy `unless-stopped`。`docker stop` 之后保持停止，直到显式 start。

### 1.1 桥协议（`bridge.mjs` + `rpc-bridge.ts`）

宿主 `RpcBridge` 连 `ws://127.0.0.1:8900`，自动重连，掉线命令进队列。

宿主 → 桥：

- `{ type:"_pibot", cmd:"start_bot"|"stop_bot"|"set_model", botId, name?, role?, model? }`
- `{ botId, data: { ...pi RPC 命令 } }`  例如 `{ type:"prompt", message }`、`{ type:"abort" }`、`{ type:"switch_session", sessionPath }`、`{ type:"new_session" }`、`{ type:"get_state" }`

桥 → 宿主：

- `{ botId, data: { ...pi 事件 } }`  `agent_start` / `message_update` / `message_end` / `tool_execution_start` / `tool_execution_end` / `agent_end` / `agent_settled` / `extension_ui_request` …
- `{ type:"_bridge", event:"bot_started"|"bot_exited"|"bot_restarted"|"stderr"|…, botId? }`

`ensureBotFiles` 会写 `settings.json`、缺失时的 `AGENTS.md` 模板、`pibot-model.json`。**它不得拥有 `APPEND_SYSTEM.md`。** Host 规则由 `BotManager.writeAppendSystem` 在每次 `start_bot` **之前**覆盖写入。

当前 RPC **没有** `set_system`。`{ type:"prompt", message }` 会在 pi 的 jsonl 里变成一条 **user** 消息。所以：

- 不要把 Host 规则 prepend 到每一条用户 prompt
- 真 system 追加今天只能走 `~/.pi/agent/APPEND_SYSTEM.md` → `/config/bots/<id>/.pi/agent/APPEND_SYSTEM.md`
- 改这个文件要 **重启该 Bot 的 pi** 才生效
- 一个 pi 进程的 APPEND 对 `main` 和 `group:*` **共用**。群专属规则不能放 APPEND，只能放 seed/turn（用户消息）

### 1.2 会话

`bot_sessions`：`(bot_id, channel) → session_path`。`main` = 1:1，`group:<id>` = 该 Bot 在某群。`BotManager.ensureChannel` 用 `get_state` / `new_session` / `switch_session` 切。同一时刻一个 Bot 只有一个 pi 进程，频道靠切 session，不是再开一个 pi。

群成员换人（`GroupManager.updateGroup`）会 `dropSessionsForGroup`，下一轮按新名单重新 seed。

### 1.3 电脑关/开（今天的语义，迁完必须改）

`POST /api/computer/start|restart|stop`

- stop：`GroupManager.abortActive()` → `BotManager.doStopComputer()`：`dropAllLive`，当时非 stopped 的 Bot 记入 `resumeBotIds` 并标 `stopped`，`bridge.close()` + `bridge = null`，`docker stop`（保留容器和卷）
- 下次 start：`startEligibleBotSessions` 唤醒 `resumeBotIds` + 本来就不是 stopped 的 Bot

**今天关电脑 = 脑子也没了**，因为 pi 在容器里。迁完之后：关电脑只停容器和 computer 工具；本机 agent 和 SQLite 还在；`resumeBotIds` 不应再为了「还能聊天」而休眠 Bot。

---

## 2. 提示词分层（最容易做错）

四层，不要混：

| 层 | 文件/函数 | 写什么 | 不写什么 |
|---|---|---|---|
| pi 默认 | 容器里 pi 自带的 coding-agent system | 别动 | 不要用 `SYSTEM.md` 整份替换（会丢掉 pi 底座） |
| Host 追加 | `server/src/prompts/sections.ts` → `buildAppendSystemPrompt()` → `APPEND_SYSTEM.md` | Tone / Reply length / Autonomy / Asking / Initiative / Never fabricate / Security / **Voice by surface** | 群 overlay、用户记忆 |
| 身份/记忆 | `/config/bots/<id>/AGENTS.md` | Preferences / Facts / Work；`ensureBotFiles` 的身份模板 | **Host 规则、编排器指令** |
| 群 overlay | `buildGroupMemberSystemPrompt` / `buildGroupSeedPrompt` / `buildGroupTurnPrompt`（`group-chat.ts`） | 你是谁、房间名、描述、名单、User 标签、隐私、怎么说话、`@` / pass / done | 整份 Tone 再贴一遍（Autonomy 从 sections **import**） |

Voice by surface（已写进 APPEND，迁完也要保住）：

- **1:1**：可见助手正文才是声音。先回话再工具。ack ≠ 交付。**禁止**「必须 `send_message` 才出声」。
- **群**：只有 `send_message` 进房间。助理正文是私稿。`bot-manager` 对群不广播 `text_delta`，避免闪一帧心里话。无工具且有正文时，扩展侧才可能把私稿当发言——迁工具时别把 1:1 的「必须 SendMessage」抄过来。

群 transcript 回灌：

- 来源：SQLite `group_messages`，**不是**把别人的话写进队友的 pi session 当他们自己的消息
- `kind=system`（主持人派单）**不进** prompt（`promptLines` 滤掉）
- `formatChatLines`：人类作者 `You` → `User`
- seed（该 Bot 第一次进 `group:<id>`）：最近最多 **24** 条（`GROUP_HISTORY_WINDOW`）
- 之后的 turn：`messagesSinceLastSpoke` 再 cap 24。24 是上限不是固定页。只有 3 条新的就只贴 3 条
- 单行 body 截到 800 字，不丢其它行
- `send_message` / `message_teammate` / `update_memory` 不进工具卡。其它工具落 `kind=tool`，显示 `Name used a tool: <120 字>`
- `isSpeechKind` 只有 `text` / `handoff`
- **没有** LLM 摘要/compaction。今天每条构造出来的 seed/turn 都会作为 user 消息堆进该 Bot 的 jsonl

群描述：`groups.description`（≤500）。seed 里一行 `Thread description: …`。UI 在标题下和线程设置里。

迁到 SDK 之后：

- 1:1 system = `buildAppendSystemPrompt()` + 身份（不要写进 AGENTS.md 当 Host 规则）
- 群 session system = APPEND 章节 + `buildGroupMemberSystemPrompt(..., description)`（**不要再当 user 消息**）
- turn 只贴新 transcript，保持短
- 换人/改描述可以 `set_system` 或等价 API，不必重启进程

---

## 3. 群编排（这一波不要重写）

Pibot 自己的编排，**不是**官方 host round-robin。文件：`server/src/groups.ts`、`group-chat.ts`、`moderator.ts`。

信号（`send_message` 参数，宿主 `interceptTool` → `parseGroupPost`）：

- `text`：房间可见正文
- `next`：精确成员名，按序
- `@Name` / `@everyone` 写在 text 里，和 `next` 一样拉人
- `pass=true`：没话说，text 丢弃不进房间
- `done=true`：这轮可以停
- `ask_user=true`：房间进入等待，UI「他们在等你」。只允许三件事：难撤销/对外动作、查不到的真歧义、只有用户知道的事

**不要把 User 放进 `next`。** 问用户用 `ask_user`，不是 next=User。

没人被 @、也没有成员交接时，才叫 LLM 主持人（`moderator.ts`）。主持人不是 Bot，是一次短补全。每群可覆盖名称/模型/thinking/tokens/history/补充说明（齿轮面板）。`reason` 用用户语言，会进房间系统行，但系统行不回灌成员 prompt。

预算：`GROUP_MAX_MEMBER_TURNS=40`，`GROUP_MAX_MODERATOR_CALLS=12`，`GROUP_MAX_WALL_MS=20min`，每成员每轮房间帖 `GROUP_MAX_MESSAGES_PER_TURN=8`。超限那条正文丢掉，但 next/done 要留下。

成员 2–6。`PUT /api/groups/:gid` 可改 `name` / `description` / `botIds`。换人会 `interruptQuiet`（bumpEpoch + abort，**不**写 “Stopped.”）+ 系统行 “X joined/left the thread.”。

迁群时只换「成员怎么被调用」（RPC prompt → 本机 SDK session）。`runGroupTurn` 的 next/done/pass/@ / 主持人语义原样留下。

---

## 4. 工具清单

扩展在容器：`bot-image/opt/pibot/extensions/pibot.ts`。改完要 **重建镜像或进容器替换** 才生效。迁到宿主后，社交/记忆工具应变成宿主工具；电脑类工具必须仍打进容器。

| 工具 | 今天谁执行 | 迁完谁执行 |
|---|---|---|
| bash / 读写真文件（pi 自带） | 容器 pi，cwd=bot 目录 | 宿主 agent **经** `ComputerAccess` → docker exec / 文件 API。目标仍是 `/config/...` |
| `browser_navigate/read/click/type/screenshot` | 容器扩展，连容器内 CDP `:9222` | 电脑在线才可用。映射 9222 **或** 容器留极薄 computer 服务 |
| `computer_screenshot` | 容器扩展，桌面截屏 | 同上 |
| `mcp_list_tools` / `mcp_call` | 容器扩展；stdio MCP 的 cwd=`/config/workspace` | 连网站/登录态的留容器。不要默默改成宿主进程碰用户机器 |
| `update_memory` | 扩展空执行；宿主 `interceptTool` 改 AGENTS.md | 宿主工具，写容器内 AGENTS.md |
| `send_message` | 扩展空执行；宿主拦截落 `group_messages` | 宿主工具。只在群 session 注册或在 1:1 禁用 |
| `message_teammate` | 宿主拦截；同群 → handoff 行；无共同群 → 对方 1:1 prompt | 宿主工具，语义不变 |
| `save_skill` | 宿主落库，全员可用 `/slug` | 宿主工具 |
| `request_approval` | `extension_ui_request` → UI approval | 宿主等价物 |

`WORK_TOOLS`、写文件路径、产出文件卡片、vision 降级（无视觉模型时 browser_screenshot 走 helper）都在 `bot-manager.ts`。迁 1:1 时对照着搬，不要丢。

Docker 文件 API（`docker-manager.ts`）**已经能从宿主用**：

- `writeFile`：tar `putArchive`（Windows npipe 下 exec stdin 会静默截断，不要改回 exec stdin）
- `readFile`：`getArchive`
- `exec`：私有，可按需暴露给 ComputerAccess
- `removePath`：只允许 `/config/bots/...`

电脑在线时这些就能干活。缺的是浏览器/截屏的远程面（CDP 没发布）。

---

## 5. 关键文件

| 路径 | 干什么 |
|---|---|
| `server/src/bot-manager.ts` | Bot 生命周期、RPC 事件、切 session、拦截工具、写 APPEND、关电脑休眠 |
| `server/src/rpc-bridge.ts` | 自动重连 WS 客户端 |
| `server/src/docker-manager.ts` | ensure/restart/stop、文件、exec |
| `server/src/groups.ts` | 群生命周期、编排循环、改名改人 |
| `server/src/group-chat.ts` | 纯函数：seed/turn、@、next、24 条窗 |
| `server/src/moderator.ts` | 主持人 LLM |
| `server/src/prompts/sections.ts` | Host 章节唯一来源 |
| `server/src/index.ts` | REST + `/ws` |
| `server/src/db.ts` | SQLite + ALTER 迁移 |
| `server/src/config.ts` | 端口、镜像名 |
| `bot-image/opt/pibot/bridge.mjs` | 容器内多路复用 pi |
| `bot-image/opt/pibot/extensions/pibot.ts` | 浏览器/MCP/社交工具 |
| `web/src/components/ComputerPanel.tsx` | 开/关/重启电脑 |
| `web/src/components/GroupChatView.tsx` / `EditGroupModal.tsx` / `GroupCluster.tsx` | 群 UI（刚做完，别拆） |
| `web/src/prefs.ts` | `theme: dark\|light`，已做完 |

已删、不要再找：`src_extract/`、`bot-mark-kit/`。`web/src/mark/` 是 Pibot 自己的头像，留下。

---

## 6. 已经做好、不要重做

- Host 章节单源 + 每次启动覆盖 `APPEND_SYSTEM.md`
- 群 `@` / `ask_user` 等待席 / 短说 / 人类标签 `User`
- 浅色主题、顶栏 ThemeToggle、设置里也能切
- `POST /api/computer/stop` + UI「关闭电脑」
- 群头像扎堆；线程可改名、描述、拉人踢人（2–6）
- 交接文件就是本文件

不要做：官方 widget、`reply_to`、abort-leftover redrive、`request_box_help`、cloud agent、跨用户房间、把编排改成 round-robin。

---

## 7. 目标架构

```
本机 Fastify
  ├─ 每 Bot 一个 in-process agent（@earendil-works/pi-coding-agent）
  │    每频道一个 session：main / group:<id>
  │    system / compact / 流式 / abort 都在本机
  │    模型配置继续用现有 model_profiles
  └─ ComputerAccess（电脑 online 才真正执行）
       status: offline | starting | online
       exec / readFile / writeFile   （已有 dockerode，包一层）
       browser / desktop screenshot  （映射 CDP 或容器内极薄服务）
       离线：工具失败信息要能给模型看，并让它用可见文字告诉用户

容器：XFCE + Chromium + 文件 +（可选）极薄 computer 服务
      不再 spawn `pi --mode rpc`
```

关电脑 = 停容器 + ComputerAccess 报离线。Agent 进程、SQLite、1:1/群 transcript 都在。再开机：工具恢复，session 不用重 seed 整段 Host 规则。

---

## 8. 实施顺序（按这个做，不要一次全翻）

允许 **双脑并存一小段**：1:1 走本机 SDK，群仍走旧 RPC。不要一上来拆 bridge。

### Slice A — 读 SDK（先读再写）

包：`@earendil-works/pi-coding-agent`。宿主是 **devDependency**；容器镜像里的是 CLI `pi`。以 **node_modules 里的类型和 README** 为准，不要猜。若没装：`npm install --workspace server`。

必须搞清：

- 怎么 new agent、设 model（对上现有 `pibot-model.json` / `ModelProfileStore` 的 baseUrl、api、key、thinking）
- 怎么设 / 换 system（1:1 vs 群）
- 怎么挂自定义工具
- 怎么恢复 session、落盘位置（应在本机 data 目录，**不要**写到 Windows 用户文档里当 workspace）
- 流式事件是否还能对上现在的 `stream` / `tool` / `agent_settled` / `extension_ui_request`
- compact / abort / steer（用户连发时现在用 `streamingBehavior: "steer"`）

找不到 `set_system` 就在本机自己管 system，不要退回「每条 prompt 前面贴 APPEND」。

### Slice B — ComputerAccess（先独立，先不要换脑子）

新建一层，例如 `server/src/computer-access.ts`，包现有 `DockerManager`：

- `status()`
- `exec(cmd, opts)`
- `readFile` / `writeFile`（复用 tar 路径）
- `assertOnline()`：离线抛明确错误，文案给模型用

浏览器/截屏选一条，写在回复里说明为什么：

1. 发布容器 9222 到宿主，本机扩展连 CDP
2. 容器留一个只做 CDP/截屏/也许 bash 的小 HTTP/WS 服务，本机工具当客户端

不要让 SDK 默认工具直接打 Windows 文件系统。

### Slice C — 先迁 1:1

一个 Bot 用本机 SDK 跑通，群仍 RPC。

建议切点：`BotManager.deliverJob` / `handleEvent` / `startBotSession`。`channel==="main"` 走新脑；`group:*` 仍 `sendToBot`。

1:1 工具：computer 类走 ComputerAccess；`update_memory` / `save_skill` / `request_approval` / `message_teammate`（无共同群）留在宿主。**不要**给 1:1 注册「必须用的 send_message」。

关电脑后 `startBotSession` 不应再失败到不能聊。需要把「Bot 在线」和「电脑在线」拆开：电脑 offline 时 Bot 仍可 `prompt`。今天 `createBot`/`startBot` 会 `ensureComputer()`——1:1 迁完后，唤醒 Bot 不应再强制开电脑。

验收（Slice C 就能测）：

- 电脑开着：1:1 问候有可见正文
- 「列一下 /config/workspace」或写个文件：工具进容器，VNC 看得到
- 关电脑后再说「在吗」：有可见回复，不 exec，不报 Bot offline
- 再开电脑，同一会话能继续干活
- 连说三句：session 里没有重复整段 Host 规则
- 换模型仍走现有档案，不要另搞一套

### Slice D — 再迁群

每个成员 `group:<id>` 改为该 Bot 的本机 session。system = APPEND + `buildGroupMemberSystemPrompt`。turn 只贴新行。

`send_message` / 群里的 `ask_user` 变成宿主工具，继续喂 `live.groupSends` / `parseGroupPost`，让 `runGroupTurn` 不用改语义。

换人后更新该 session 的 system + roster，不要靠重启 pi。

验收：

- 「大家好」仍有人开口（不要关键词猜意图，现有逻辑已处理）
- `@Name` 仍拉人；短说仍在
- `ask_user` 仍出现「他们在等你」
- 主持人齿轮仍可用
- 改名/描述/拉人踢人仍可用
- 关电脑后群里仍能纯聊天；有人要截屏/bash 时成员用可见 `send_message` 说电脑离线

### Slice E — 拆桥

所有 Bot 的 1:1 和群都不再 `pi --mode rpc` 之后：

- 删宿主 `RpcBridge` 和 `start_bot` 路径
- 镜像可先留 `pi` CLI，最后再瘦
- 关电脑不再 `dropAllLive` / 全员 `stopped`
- `resumeBotIds` 只用于「用户明确休眠的 Bot」，不是关电脑的副作用

---

## 9. 硬约束

- 一台共享电脑，不是每 Bot 一个容器。旧的 per-bot 容器迁移代码（`removeLegacyContainer`）不要复活成默认架构
- SDK cwd / workspace ≠ `C:\Users\Admin\Desktop\project\pibot`，≠ 用户 Windows 主目录
- 对用户叫「电脑」
- 1:1 禁止官方那句「SendMessage is your only voice」
- 群禁止泄漏 1:1；transcript 里人类是 `User`
- 不写 Host 规则进 `AGENTS.md`（那是 Memory 模态框）
- 不搬 widget / `reply_to` / cloud agent
- 主持人、编排循环不要重写
- MCP stdio 的登录态/浏览器在容器
- PowerShell 没有 `&&`；git commit 用这里的风格，且只有用户说 commit 才做
- 不要改本交接文件里的任务目标来迁就半吊子实现

---

## 10. 总验收

- [ ] 关电脑 + 1:1「在吗」→ 可见回复，不 exec
- [ ] 开电脑 + 「看看桌面 / 列 /config/workspace」→ 容器工具，VNC 看得到
- [ ] 同一 1:1 三句 → 无重复 Host 规则
- [ ] 群「大家好」开口；`@` 拉人；短说
- [ ] 停/起电脑：`/config/workspace` 和各 Bot `AGENTS.md` 还在
- [ ] 关电脑前在跑的 Bot：开电脑后 **工具**能用；聊天在关机期间也不该断（这是相对今天的行为变化，是目标不是 bug）
- [ ] 线程设置（改名/描述/成员）仍工作
- [ ] 浅色主题、关电脑按钮仍在

---

## 11. 不要做

- 不要把脑子留在容器里只换一套 RPC 字段
- 不要半迁：RPC 还在，却把一部分工具改成打 Windows
- 不要为了省事让 Bot 在 Windows 上 bash
- 不要从本机再去找已删的官方摘录
- 不要 1:1 没绿就拆 bridge / 删 `pi`
- 不要把群 overlay 继续当 user 消息「先顶一下」——那正是这次要消灭的
- 不要把 User 放进 `next`
- 不要 commit，除非用户说

---

## 12. 做完怎么回

用几段话，不要长篇：

1. SDK 怎么挂上的（创建、system、工具、session 路径）
2. 电脑离线时工具怎么失败、1:1 怎么仍能说
3. 群 system 怎么按 session 换
4. CDP/截屏选了映射还是薄服务
5. 还剩什么（桥、镜像里的 pi、双脑残留）

先读：`bot-manager.ts` 的 `deliverJob` / `handleEvent` / `startBotSession` / `doStopComputer`，`bridge.mjs` 的 `startBot`，`sections.ts`，`group-chat.ts` 的 seed/turn，`docker-manager.ts` 的文件 API，以及 `@earendil-works/pi-coding-agent` 的类型。然后从 Slice A 开始。
