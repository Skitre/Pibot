# Findings: Host SDK 迁移

## Requirements
- 脑子从容器 `pi --mode rpc` 迁到本机 `@earendil-works/pi-coding-agent`（server devDependency `^0.84.1`，不是 Cursor SDK）
- 关电脑后 1:1/群仍能聊；bash/浏览器/截屏不可用时说「电脑离线」
- 1:1 与群不同 system；Host 规则不进 session jsonl
- SDK cwd ≠ Windows 工程目录 / 用户桌面；工具经 ComputerAccess 打容器 `/config/...`
- 不重写群编排；不搬 widget / reply_to / cloud agent

## Research Findings

### 仓库状态
- HEAD `fedafce`，与交接一致。工作区只脏 `handoff-host-sdk.md`。
- 根目录没有 `node_modules`。SDK 只写在 `server/package.json`，尚未安装。
- `DATA_DIR` = `server/data`（SQLite）。本机 session 应落这里，不要写用户文档。

### 今天脑子和电脑绑死的切点（`bot-manager.ts`）
- `createBot` / `startBot` / `startup` 都 `ensureComputer()`。
- `startBotSession` 依赖 `this.bridge`，并先 `writeAppendSystem`（docker write）。
- `sendPrompt`：`!state || !this.bridge?.connected` → 落「Bot is offline」。
- `doStopComputer`：`dropAllLive` + 非 stopped Bot 进 `resumeBotIds` 并标 `stopped` + 拆桥 + `docker stop`。
- 同一 Bot 一个 pi；`ensureChannel` 用 `get_state` / `new_session` / `switch_session`。
- `deliverJob` 发 `{ type:"prompt", message }`，连发时 `streamingBehavior: "steer"`。
- 群 overlay 今天是 **user 消息**（`buildGroupSeedPrompt` 把 `buildGroupMemberSystemPrompt` 整段贴进 seed）。

### 提示词四层（已存在，迁时不要混）
- Host：`buildAppendSystemPrompt()` → 今天写 `APPEND_SYSTEM.md`
- 身份/记忆：容器 `/config/bots/<id>/AGENTS.md`（`ensureBotFiles` 只在缺失时写模板）
- 群 overlay：`buildGroupMemberSystemPrompt` / seed / turn
- Voice by surface：1:1 可见正文是声音；群只有 `send_message`

### SDK（已装 0.84.1，对照 `dist/*.d.ts` + `examples/sdk/12-full-control.ts`）
入口：`createAgentSession`。推荐照 12-full-control：自管 `ResourceLoader` + `SettingsManager.inMemory` + 隔离 `ModelRuntime`。

| 需求 | 已确认 |
|---|---|
| 创建 | `createAgentSession({ model, thinkingLevel, modelRuntime, cwd, agentDir, noTools, customTools, resourceLoader, sessionManager, settingsManager })` |
| 换 system | **没有** `set_system`。自管 `getSystemPrompt()`。`setActiveToolsByName` 会 `_rebuildSystemPrompt` 再读 loader。`session.reload()` 也会 `resourceLoader.reload()` |
| 自定义工具 | `defineTool` + `customTools`；`noTools: "builtin"` 关掉 read/bash/edit/write |
| 恢复 session | `SessionManager.create(cwd, sessionDir)` 第二参可指定本机目录；`open(path)` |
| 流式 | `subscribe`：`message_update` / `tool_execution_*` / `agent_start` / `agent_end`。**没有 `agent_settled`**，用 `agent_end` + `waitForIdle` |
| abort / steer | `session.abort()`；`prompt(..., { streamingBehavior: "steer" })` |
| 换模型 | `setModel` / `setThinkingLevel`；档位含 off/minimal/low/medium/high/xhigh |
| 中转模型 | `ModelRuntime.registerProvider(id, { baseUrl, apiKey, api, models })`，与容器 `pi.registerProvider("pibot", …)` 同形。`ModelRuntime.create({ authPath, modelsPath })` 指向 `server/data`，不要 `~/.pi/agent` |

Windows 硬坑（Slice C 必须避开）：
- `createAgentSession` 对 cwd 做 `resolvePath`。Windows 上 `isAbsolute("/config/bots/x")===true`，会变成 `C:\config\bots\x`
- `buildSystemPrompt` 在 customPrompt 末尾会追加 `Current working directory: ${cwd}`
- 做法：`noTools: "builtin"`；cwd/agentDir 用 `server/data/...` 隔离目录（不是工程根、不是用户桌面）；system 正文写清容器路径 `/config/bots/<id>` 和 `/config/workspace`；必要时创建后改写 `session.agent.state.systemPrompt` 去掉 Windows cwd 行
- `DefaultResourceLoader` 会扫 cwd 向上的 AGENTS.md，并可能读 `APPEND_SYSTEM.md`。必须自管 loader：`getAgentsFiles=[]`，`getAppendSystemPrompt=()=>[]`，身份自己拼进 `getSystemPrompt`

`customPrompt` 不会丢掉 pi 底座工具说明以外的东西：有 customPrompt 时用我们的全文 + 可选 context/skills + cwd 行。不要用 `SYSTEM.md` 整份替换的旧路径；我们自己拼 Host 章节 + 身份。

### 电脑文件 API（已有）
`DockerManager.writeFile`（tar putArchive）、`readFile`（getArchive）、`exec`（已公开）、`removePath`（仅 `/config/bots/...`）。宿主入口是 `ComputerAccess`。浏览器/截屏走容器内 `127.0.0.1:8792` 薄服务（CDP 仍 `127.0.0.1:9222`，**不映射**）。请求/响应当 `/config/.pibot/req-*.json` + curl `-o`，避免 npipe 截断大图。

### 扩展工具（容器 `pibot.ts`）
社交/记忆：`update_memory` / `send_message` / `message_teammate` / `save_skill` / `request_approval` — 迁宿主。
电脑：`browser_*` / `computer_screenshot` — 必须仍打容器。
MCP：用户要求搬本机。HTTP/stdio 都在宿主进程连；stdio cwd=`server/data/mcp-cwd`。关电脑也能聊着用。浏览器登录态仍属电脑，以后薄服务只做浏览器/截屏。
内置：read/write/edit/bash — 迁完必须经 ComputerAccess，不能打 Windows。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 浏览器/截屏：容器薄服务，不映射 9222 | 现有扩展已连容器内 CDP；映射调试口到宿主不安全，Windows 防火墙也烦 |
| Slice C 可先不做浏览器，bash/读写先经 ComputerAccess | 1:1 验收是问候、列/写 `/config/workspace`、关电脑仍能聊；浏览器可跟薄服务一起做 |
| 本机 session 落 `server/data/sessions/<botId>/` | 已有 DATA_DIR；关电脑后脑子还在 |
| 1:1 不注册 send_message | Voice by surface；禁止「必须 SendMessage 才出声」 |
| 群 session 键 `${botId}::group:<id>`，jsonl 在 `sessions/<botId>/g-<id>` | 与 1:1 隔离；cwd 仍是 Windows-safe 的 agent-cwd |
| 旧 RPC `bot_sessions` 路径不算 hasSession | 避免空 jsonl 却跳过首轮 transcript |
| 换人只 drop 离开者 + 刷新 overlay | 不必重启、不必全员重 seed |
| 关电脑 dropRpcSide 不再 abandon 群回合 | 群已在本机；掐掉会破坏「关电脑还能聊」 |
| Slice E 删除宿主 RpcBridge，不删镜像里的 pi/bridge.mjs | 交接：先拆宿主路径，镜像后瘦 |
| 镜像瘦身 1+2：去 pi/桥，不重装 Chromium | webtop 无 Node，只补 nodejs+scrot；6.18GB→5.17GB |
| Phase 9 换底座，不压扁 webtop | apt purge 不减层；用户选「直接干 2」 |
| 每 Bot 一块屏幕 ≠ 每 Bot 一台电脑 | 同一 VM、同一盘、同一套 cookie；分开的是指针和画面，不是安全边界 |
| 本档仍共用 :1 + 每 Bot 标签 | 换底座先对齐现有面板；分屏以后再做 |
| 桌面美化：Greybird-dark + Plank 坞 | XFCE 底栏收不短；Plank 做正中三图标，会话不再起 xfce4-panel |
| 电脑 online = 容器 running，不再等 8900 桥 | 否则关桥后电脑会永远 starting |
| 关电脑不 abort 群、不标 Bot stopped | resumeBotIds 只该服务用户点的休眠 |
| MCP 客户端在本机，不走容器薄服务 | 用户纠正：聊天也要用 MCP，关电脑不该断 |
| Host 规则只进 `systemPromptOverride`，永不 prepend 到 prompt | 消灭 jsonl 里重复 Tone/Autonomy |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 仓库无 node_modules，无法读 SDK 类型 | Phase 1 先 npm install |

## Resources
- 交接：`handoff-host-sdk.md`
- SDK 文档：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- 示例：https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/sdk
- `server/src/bot-manager.ts`（deliverJob / startBotSession / doStopComputer / sendPrompt）
- `server/src/docker-manager.ts`
- `server/src/prompts/sections.ts`
- `server/src/group-chat.ts`
- `bot-image/opt/pibot/bridge.mjs`（ensureBotFiles / startBot）
- `bot-image/opt/pibot/extensions/pibot.ts`（registerProvider + 工具）
