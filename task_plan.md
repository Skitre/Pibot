# Task Plan: 把 Bot 脑子从容器 RPC 迁到本机 SDK

## Goal
本机 Node 用 `@earendil-works/pi-coding-agent` 跑模型循环；容器只当共享电脑。关电脑后 1:1/群仍能聊；Host 规则进 system，不进 jsonl。

## Current Phase
Phase 9: 换掉 webtop 底座（Debian + XFCE + noVNC）

## Phases

### Phase 1: Slice A — 读 SDK
- [x] `npm install --workspace server`
- [x] 对照 node_modules 类型：createAgentSession、systemPromptOverride、customTools、SessionManager、setModel、abort/steer、事件
- [x] 确认自定义中转模型怎么挂（`ModelRuntime.registerProvider`，对上现有 pibot provider）
- [x] 确认没有 `set_system`：自管 ResourceLoader + `getSystemPrompt()`；换人后 `setActiveToolsByName` 会重建
- **Status:** complete

### Phase 2: Slice B — ComputerAccess
- [x] 新建 `server/src/computer-access.ts`，包 DockerManager
- [x] status / exec / readFile / writeFile / assertOnline
- [ ] 浏览器/截屏：容器内极薄服务（不映射 9222；Slice C 先不挡 1:1）
- **Status:** complete

### Phase 3: Slice C — 先迁 1:1
- [x] 本机 session：main 走 SDK，group:* 仍 RPC
- [x] 拆开「Bot 在线」和「电脑在线」
- [x] 关电脑后 1:1 仍能说话；三句无重复 Host 规则
- **Status:** complete

### Phase 4: Slice D — 再迁群
- [x] group:<id> 本机 session；system = APPEND + group overlay
- [x] send_message 等宿主工具；runGroupTurn 语义不动
- [x] 茶水间「大家好」三人开口；关电脑后仍能群聊
- **Status:** complete

### Phase 5: Slice E — 拆桥
- [x] 删宿主 RpcBridge / start_bot；关电脑只停容器
- [x] resumeBotIds 不再当关电脑副作用；MCP 探测不再走桥
- **Status:** complete

### Phase 6: 本机 MCP
- [x] 宿主 `HostMcpHub`：stdio / HTTP+SSE，不经容器
- [x] `mcp_list_tools` / `mcp_call` / Settings 测试走本机；关电脑也能用
- [x] stdio cwd = `server/data/mcp-cwd`，不碰工程目录和用户桌面
- [x] 浏览器/截屏仍留容器（Phase 7）
- **Status:** complete

### Phase 7: 浏览器 / 桌面截屏
- [x] 容器 `computer-service.mjs`：CDP 浏览器 + scrot 桌面截屏，听 127.0.0.1:8792
- [x] ComputerAccess.service：请求/响应当文件，避开 npipe 截断
- [x] 本机 `browser_*` / `computer_screenshot`；离线说文案，不 exec
- [x] 不映射 9222；视觉/helper 仍在本机
- **Status:** complete

### Phase 8: 镜像瘦身
- [x] 去掉全局 `pi`、bridge、旧扩展、8791 映射
- [x] 不再重装 Chromium；只补 nodejs + scrot（webtop 已有 git）
- [x] `/opt/pibot` 只留薄服务 + playwright-core
- [x] 重建镜像并换容器（保留 `/config` 卷）
- **Status:** complete

### Phase 9: 换底座
- [x] Debian + XFCE + TigerVNC/noVNC + Chromium，不带 DinD/Selkies
- [x] 卷 `/config` 保留；面板仍走 :3100
- [x] 每 Bot 一块屏幕：先讲清做法，本档仍共用一块桌面
- **Status:** complete

## Key Questions
1. SDK 能否在不重启 session 的情况下换 system？（群换人/改描述）
2. 自定义中转模型是 `registerProvider` 还是 `ModelRuntime` + models.json？
3. 本机 session 落盘目录定在 `server/data/sessions/` 还是别处？
4. 内置 bash/read/write 能否完全关掉，只留 ComputerAccess 工具？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 按 A→B→C→D→E 切片，双脑并存 | 交接硬性；1:1 没绿不拆桥 |
| 浏览器/截屏走容器薄服务，不映射 9222 | CDP 已在容器 127.0.0.1:9222；映射到 Windows 暴露调试口，且现有扩展已会连容器内 CDP |
| SDK cwd/agentDir 隔离到本机 data，工具不打 Windows | 交接硬约束；默认 `process.cwd()` / `~/.pi/agent` 会踩工程目录和用户主目录 |
| 不改 handoff-host-sdk.md 的任务目标 | 交接要求 |
| 不 commit，除非用户说 | 交接 + 用户规则 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| pkill -f computer-service.mjs 自杀启动脚本 | 1 | 改 fuser -k 8792 + setsid |
| webtop 没有 node/npm，只有 Chromium | 1 | 只装 nodejs + scrot，不重装 Chromium |

## Notes
- 上一轮群聊自然回应的计划已完成，本文件改记本轮迁移。
- 对用户只说「电脑」。
- 服务端改完必须重启 `npm run start --workspace server`（先杀 8790）。
