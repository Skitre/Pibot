# Findings: 群聊自然回应 + 第二批缺陷

## Requirements
- 非任务场景也要有人开口；不要用关键词/正则/分类表决定谁说话
- send_message 增加结构化 pass
- 修 resolveMembersByNames 顺序、救场连叫、单回合上限、ComputerPanel deps
- 查清 pi 消失但 status=online；删遗留测试群
- 三个真实场景贴 transcript；没验证的必须写「没验证」

## Research Findings
- 上一轮三层提示词把「没任务」写成「闭嘴 / pass」，主持人还硬性 Prefer one next speaker。
- `isPassContent` 只认字面 `(pass)`。模型把「保持待命」写成正文，就会落库。
- `resolveMembersByNames` 改成 `members.filter` 后输出变成花名册顺序，`mergeNextNames` 的输入顺序被丢掉。
- 救场用 `speakCount==0` 找人：pass 后键存在值仍是 0，且没排除 `lastSpeakerId`，会连叫同一人。
- `GROUP_MAX_MESSAGES_PER_TURN` 取消截断后没有任何引用；40 条预算不在单回合内检查。
- `ComputerPanel` 依赖 `[bot]` 会在每次 `bot_update` 重拉 routines。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 主持人按「这条消息期待多少人开口」邀请，宁可多请 | 成员可以 pass；漏请会把用户晾着。不列举消息类型。 |
| 成员：有话就说，pass=true 才沉默；用用户的语言 | 对应「大家好」被当成没活而不说话 |
| 结构化 pass 优先，字面 (pass) 仅兜底 | 最后一处靠文本猜意图 |
| 单回合硬顶 8，在 interceptTool 同时停落库和 groupSends | 保持三者一致；next/done 合并函数本身不改 |
| 救场：排除 lastSpeaker + rescued 每人一次 | 避免 pass 后反复点同一个人 |
| `bot_exited intended=true` 时若 status 不是 stopped 则写成 stopped | 不自动拉起，避免用户停掉的 Bot 复活；只修「死了还显示 online」 |
| ComputerPanel 还原 `[bot?.id]`，旁边加 oxlint-disable | 用户要求还原这行；lint 必须无警告 |

## 第 9 项：pi 进程消失但 status=online

### 桥里谁会停 pi
- `stopBot()`：只由宿主 `_pibot cmd: stop_bot` 调用（`BotManager.stopBot` / `deleteBot`）。它先把 `session.stopping=true` 再 `kill`，exit 时 `intended=true`。
- `setModel()`：配置变了才 `s.stopping=false` 然后 kill，走自动重启，`intended=false`。
- WS `close` **不会**停 Bot。宿主进程被杀掉也不会发 `stop_bot`。
- 意外退出：`stopping=false`，1 秒后自动 `startBot`；宿主把 status 写成 `starting`。

### 宿主侧的洞
- `stopBot()` 会先 `setStatus(stopped)` 再发 `stop_bot`。正常路径下 `intended=true` 到达时 DB 已经是 stopped。
- `bot_exited intended=true` 若没对上一次 `stopBot`（旧进程、状态没写上），旧逻辑原样保留 status，于是 UI 继续 online。
- 更常见的分裂：电脑/容器重启杀掉全部 pi，宿主 `this.bridge` 还在，旧 `attachBridgeIfNeeded` 直接 return、不再 `start_bot`。上一轮已补拉会话。
- 本次复查时容器已运行 51 分钟，3 个 `pi` 从 15:43:35 一直活着，TCP `172.17.0.2:8791` ESTAB。用户看到「现在没有 pi」时，更像是上一轮那个洞的残留观察，而不是 `intended=true` 把进程停掉。

### 本次代码
- 不在 `intended=true` 时自动重启。
- 若 intended 退出且 status 仍不是 stopped，改写成 stopped，避免假 online。

## 实测 transcript（2026-08-16）

容器扩展已含 `pass:`。`docker cp` 后 stop/start 三个 Bot，新 pi pid 7672/7673/7674。

遗留群 `27149a6c`、`a6642635` 复查时已不在 `/api/groups`（只剩用户自己的 `ttk` / `ttkk`，未动）。

### 场景 A1：「大家好」（群名 `tmp-natural-verify`）——被群名/上次任务带跑

```
You: 大家好
Judy: [ls workspace] [write tmp-natural-verify.md]
Judy: 大家好，我已创建 … 请 @Ashford …
Ashford: 已完成第 2 步… 请 @蜻蜓队长 …
蜻蜓队长: 已完成第 3 步… 验证通过
System: Task complete.
```

三人用了中文，没有「我保持沉默」。但他们把问候理解成又一次写 md 分工。群名带 verify，且 workspace 里还有上次验证痕迹。

### 场景 A2：「大家好」（群名 `茶水间`，清掉测试 md 后重跑）

```
You: 大家好
Ashford: 茶水间有点安静呀～ @Judy @蜻蜓队长 有空来聊聊天，或者有什么需要帮忙的也尽管说 😄
Judy: 哈哈，茶水间确实有点冷清 😄 @Ashford 我在呢～随时可以帮忙，大家有需要尽管开口。@蜻蜓队长 也来聊聊呗～
蜻蜓队长: 哈哈来了来了 😄 茶水间就是要热闹点才有氛围嘛。我在的，随时待命——大家想聊啥都行，或者有活儿要搭把手的尽管说！
System: 大家的问候都已回应，没有更多需要补充的内容。
```

三人各自一句中文问候，没有 pass 正文，没有造文件。

### 场景 B：具体任务（只要 Judy 写文件）

```
You: @Judy 请只在共享 workspace 写一个短文件 tmp-natural-task.md，内容写三行「任务验证」。其他人不要动手，Judy 写完就 done。
Judy: [write] 已完成 ✅ 已在共享 workspace 写入 … 本次任务到此结束。
System: Task complete.
```

Ashford / 蜻蜓队长没有开口。放宽主持人没有变成全员都来一句。

### 场景 C：开放讨论

```
You: 你们怎么看：群聊里要不要默认每条消息都全员回复？请各自用一两句说说理由。
Judy: 我认为不需要默认全员回复：…
Ashford: 同意 Judy：不需要全员默认回复。…
蜻蜓队长: 我也同意不需要全员默认回复。…
System: Task complete.
```

三人各自发表看法，中文。

### 回归
- Judy 私聊「只回复一个词：pong」→ `pong`
- 讨论开场前对 Judy 发了 `abort channel=main`，三人仍答完

临时群 `3421ff13`、`a97f9367` 已删；`tmp-natural-*.md` 已从 workspace 去掉。

## 没验证
- 单回合超过 8 条 send_message 是否被 interceptTool 丢掉
- 救场分支（主持人 done 且发言数 0）是否按 rescued 轮询
- `resolveMembersByNames` 的输入顺序（本轮没有构造「先 B 后 A」的 next 列表）
- 模型只写 `(pass)` 字面量、不带 `pass:true` 的旧路径
- `bot_exited intended=true` 把假 online 改成 stopped（本次 pi 一直活着，没抓到这条事件）

## Resources
- server/src/moderator.ts
- server/src/group-chat.ts
- server/src/groups.ts
- server/src/bot-manager.ts
- bot-image/opt/pibot/extensions/pibot.ts
- web/src/components/ComputerPanel.tsx
- bot-image/opt/pibot/bridge.mjs
