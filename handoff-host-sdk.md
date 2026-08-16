# 交接：把 Bot 脑子从容器 RPC 迁到本机 SDK

把下面整段（含本文件其余部分）交给下一个模型，让它继续做。不要改计划文件。先读代码再动手。Windows / PowerShell。不要 commit，除非用户明确说。

---

你在 `C:\Users\Admin\Desktop\project\pibot` 上继续 Pibot。这是本机单用户版 Grok Bot：React UI（5190）+ Fastify（8790）+ 一台共享 Docker 电脑 `pibot-computer-shared`。

## 你要做的事

把 **模型循环（脑子）** 从容器里的 `pi --mode rpc` 搬到 **本机 Node**，用 `@earendil-works/pi-coding-agent`（已在 `server/package.json`，^0.84.1）。容器只当 **电脑**。

做成之后：

- 电脑关掉，1:1 / 群聊还能说话（不能 bash / 浏览器 / 截屏时，如实说电脑离线）。
- 可以按会话换 system（1:1 与群不再共用一份 APPEND）。
- 不要再把整段 Host 规则当成用户消息塞进 jsonl。
- 不要再靠改 `APPEND_SYSTEM.md` + 重启 pi 才能换提示词。

官方对照（已删 `src_extract`，不要去翻官方源码）：Host 跑对话和 `SendMessage`；box 只是电脑。关掉 box 还能聊。Pibot 现在把 `pi` 塞进容器，所以关电脑 = Bot 全休眠。用户要的是官方这条切法，**不是** SDK 去碰 Windows 用户磁盘。

## 现在怎么跑（必须先看懂再拆）

```
浏览器 :5190
  → Fastify :8790（编排、SQLite、dockerode）
    → ws://127.0.0.1:8900 → 容器 8791 bridge.mjs
      → 每个 Bot 一个 `pi --mode rpc`，HOME=/config/bots/<id>
```

- 共享文件：`/config/workspace`（卷 `pibot-computer-data`）。
- 记忆：`/config/bots/<id>/AGENTS.md`（Preferences / Facts / Work）。**不要往这里写 Host 规则。**
- 真 system 追加：启动时宿主写入 `/config/bots/<id>/.pi/agent/APPEND_SYSTEM.md`（`server/src/prompts/sections.ts` 的 `buildAppendSystemPrompt()`）。RPC **没有** `set_system`。
- 群聊：每 Bot 一条 `group:<id>` session，`switch_session` 和 `main` 切换。群 overlay 在 `buildGroupSeedPrompt` / `buildGroupTurnPrompt`（`server/src/group-chat.ts`），作为 **用户消息** 打进 `{ type: "prompt" }`。别人的话来自 SQLite `group_messages`，`formatChatLines`；turn 只贴「上次开口之后」，上限 24 条。工具卡是 `X used a tool: …`，不当发言。
- 群编排是 Pibot 自己的：`next` / `done` / `pass` / `ask_user` + LLM 主持人（`server/src/moderator.ts`）。**不要**改成官方 round-robin，**不要**把 User 放进 `next`。
- 声音：1:1 = 可见助手正文；群 = 只有 `send_message` 进房间。APPEND 里的 Voice by surface 已经写清。
- 电脑：`POST /api/computer/start|restart|stop`。stop 停容器、关 bridge、把当时在跑的 Bot 标 `stopped` 并记入 `resumeBotIds`，下次 start 再拉起。VNC 映射宿主 3100；bridge 8900。Chromium CDP 在容器内 `127.0.0.1:9222`，**没有**映射到宿主。
- 工具扩展：`bot-image/opt/pibot/extensions/pibot.ts`（浏览器 / 截屏 / MCP / send_message / ask_user / memory）。改完要进容器才生效。
- 浅色模式：`web/src/prefs.ts` 的 `theme`，顶栏 `ThemeToggle`，设置里也能切。

关键文件：

- `server/src/bot-manager.ts` — 生命周期、RPC、拦截工具、写 APPEND
- `server/src/rpc-bridge.ts` — 自动重连的 WS 客户端
- `server/src/docker-manager.ts` — ensure/restart/stop、writeFile/readFile/exec
- `server/src/groups.ts` / `group-chat.ts` / `moderator.ts`
- `server/src/prompts/sections.ts`
- `bot-image/opt/pibot/bridge.mjs`
- `web/src/components/ComputerPanel.tsx`

## 目标架构

```
本机 Fastify
  ├─ 每 Bot 一个 in-process agent（pi-coding-agent SDK）
  │    system / session / compact / 流式 都在本机
  └─ Computer 工具面（电脑在线才可用）
       docker exec / writeFile / readFile
       浏览器：映射 CDP 或容器内极薄 computer 服务
       桌面截屏：同类
容器：只跑桌面 + Chromium + 文件，不再 spawn pi
```

关电脑 = 停容器 + 工具返回「电脑离线」。Agent 和 SQLite 会话还在，用户能继续聊。

## 实施顺序（按这个做，不要一次全翻）

1. **读 SDK。** 看 `@earendil-works/pi-coding-agent` 怎么创建 agent、设 system、挂自定义工具、恢复 session、流式事件。以包内文档/类型为准，不要猜。宿主已有 devDependency，容器镜像里的是 CLI `pi`。
2. **电脑控制面先独立。** 在 server 里收一层 `ComputerAccess`：`exec`、读写 `/config/...`、状态 `offline|starting|online`。浏览器/截屏要么发布 9222，要么容器留一个只做 CDP/截屏的小服务。现有 dockerode 方法复用。
3. **先迁 1:1。** 一个 Bot 用本机 SDK 跑通：问候、工具（电脑开着）、电脑关掉仍能回话、再开机能继续干活。群聊先仍走旧 RPC，允许双脑并存一小段。
4. **再迁群。** 群 overlay 改为该 session 的 system（或 SDK 等价物），不要再当用户消息。`send_message` / `ask_user` 变成宿主工具。编排器（next/done/pass/@）不要改语义。
5. **拆桥。** 没有 Bot 再走 `pi --mode rpc` 后，删 `bridge.mjs` 的 start_bot 路径和宿主 `RpcBridge`。镜像不再需要整份 pi CLI（可留到最后）。

## 硬约束

- 一台共享电脑，不是每 Bot 一个容器。不要让 SDK 默认 cwd 变成 Windows 工程目录去改用户文件。
- 对用户叫「电脑」，不叫 box。
- 1:1 禁止「必须 send_message 才出声」。
- 群禁止泄漏 1:1；人类在 transcript 里是 `User`。
- 不写 Host 规则进 `AGENTS.md`。
- 不搬官方 widget / `reply_to` / cloud agent / 跨用户房间。
- 主持人、编排循环这一波不要重写，只换成员怎么被调用。
- MCP：连网站/登录态的放容器；不要默默改成宿主进程去碰用户机器。
- 服务端改完要重启 `npm run start --workspace server`（tsx 无 watch，8790）。先杀占用再起。

## 验收

- 关电脑后发 1:1「在吗」：有可见回复，不报 Bot offline，也不去 exec。
- 开电脑后「看看桌面 / 列一下 /config/workspace」：工具打进容器，VNC 看得到。
- 同一 1:1 连说三句：session 里没有重复整段 Host 规则。
- 群「大家好」仍开口；成员 `@` 仍拉人；短说仍在。
- 停/起电脑：文件和 AGENTS.md 还在；关之前在跑的 Bot 开机会回来。

## 不要做

- 不要把脑子留在容器里只换一套 RPC 字段。
- 不要为了省事让 Bot 在 Windows 上 bash。
- 不要从本机再去找已删的 `src_extract` / `bot-mark-kit`。
- 不要一上来删 bridge，1:1 没绿再拆群。

做完用几段话说明：SDK 怎么挂上的、电脑离线时工具怎么失败、群 system 怎么换、还剩什么。
