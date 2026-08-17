# Progress Log

## Session: 2026-08-16（Host SDK 迁移）

### Phase 1: Slice A — 读 SDK
- **Status:** complete
- **Started:** 2026-08-16 20:41
- Actions taken:
  - 读完 `handoff-host-sdk.md`；`git log` 对上 `fedafce`
  - 读了 bot-manager / docker-manager / sections / group-chat / model-profiles / config / index / bridge / 扩展入口
  - `npm install --workspace server`，对照 0.84.1 类型与 `examples/sdk/12-full-control.ts`
  - 确认 Windows 上 `/config/...` 作 cwd 会被 resolve 成 `C:\config\...`
- Files created/modified:
  - task_plan.md / findings.md / progress.md

### Phase 2: Slice B — ComputerAccess
- **Status:** complete
- Actions taken:
  - ComputerAccess + docker inspect/exec cwd
- Files created/modified:
  - server/src/computer-access.ts
  - server/src/docker-manager.ts

### Phase 3: Slice C — 1:1 本机 SDK
- **Status:** complete
- Actions taken:
  - host-agent / host-tools：自管 ResourceLoader、ModelRuntime.registerProvider、内置工具 operations 打容器
  - BotManager：main 走 host.prompt；关电脑只 dropRpcSide；startup 不强制开电脑
  - 实测 Judy：pong / 三句无 Host 规则入 jsonl；bash 列 /config/workspace；关电脑「在吗」→「在的。」；再开电脑工具恢复
- Files created/modified:
  - server/src/host-agent.ts
  - server/src/host-tools.ts
  - server/src/bot-manager.ts
  - server/package.json (typebox)

### Phase 5: Slice E — 拆桥
- **Status:** complete
- Actions taken:
  - 删除 `rpc-bridge.ts` 与 start_bot / ensureChannel / dropAllLive / resumeBotIds
  - 关电脑只 `docker stop`；`POST /api/computer/stop` 不再 abort 群
  - 电脑 online = 容器在跑，不再等桥；开机只同步 AGENTS.md
  - MCP 探测改为明确未接通（等电脑薄服务）
  - 关/开电脑文案改成 Bot 还能聊
  - 冒烟：全员 online 不卡 starting；关电脑 Judy「在吗」→「在的。」且未标 stopped；开机 bash 列出 /config/workspace
- Files created/modified:
  - server/src/bot-manager.ts
  - server/src/index.ts
  - server/src/rpc-bridge.ts (deleted)
  - web/src/i18n.ts

### Phase 4: Slice D — 群本机 SDK
- **Status:** complete
- Actions taken:
  - 每成员 `group:<id>` 独立本机 session；system = Host 章节 + AGENTS.md + overlay
  - 首轮 user 只贴 transcript；换人/改名改描述 `setSystem`，不再 drop 全员
  - `send_message` 只挂群 session；关电脑不再掐本机群回合
  - 茶水间「大家好」Judy/Ashford/蜻蜓队长开口；关电脑后再问好仍有人回
- Files created/modified:
  - server/src/host-tools.ts
  - server/src/host-agent.ts
  - server/src/bot-manager.ts
  - server/src/group-chat.ts
  - server/src/groups.ts

### Phase 6: 本机 MCP
- **Status:** complete
- Actions taken:
  - 用户纠正：MCP 要搬本机，不是容器薄服务
  - 删 computer-service.mjs / s6 unit；ComputerAccess 不再调 8792
  - 新增 `HostMcpHub`（stdio + HTTP/SSE），Settings 测试不再 `ensureComputer`
  - 工具 `mcp_list_tools` / `mcp_call` 走本机；stdio cwd=`server/data/mcp-cwd`
- Files created/modified:
  - server/src/host-mcp.ts
  - server/src/host-tools.ts
  - server/src/host-agent.ts
  - server/src/bot-manager.ts
  - server/src/computer-access.ts
  - server/package.json
  - web/src/i18n.ts

### Phase 7: 浏览器 / 桌面截屏
- **Status:** complete
- Actions taken:
  - 容器薄服务只做浏览器 + scrot；本机工具当客户端
  - 请求/响应走 `/config/.pibot/req-*.json` + curl `-o`，大图不经 npipe stdout
  - 启动脚本不能 `pkill -f` 自己，改 `fuser -k 8792` + setsid
  - 冒烟：桌面截屏 70KB；`about:blank` 打开成功
- Files created/modified:
  - bot-image/opt/pibot/computer-service.mjs
  - bot-image/root/custom-services.d/pibot-computer
  - server/src/computer-access.ts
  - server/src/host-tools.ts
  - server/src/bot-manager.ts

### Phase 8: 镜像瘦身
- **Status:** complete
- Actions taken:
  - 删 bridge / 旧扩展 / 全局 pi；不再映射 8791
  - webtop 已有 Chromium、git，没有 Node；只装 nodejs 22 + scrot
  - 重建镜像并换容器，卷保留；5.17GB
- Files created/modified:
  - bot-image/Dockerfile
  - bot-image/opt/pibot/package.json
  - server/src/docker-manager.ts

### Phase 9: 换底座
- **Status:** complete
- Actions taken:
  - 丢掉 webtop：`debian:trixie-slim` + XFCE + TigerVNC + noVNC + Chromium + Debian Node 20
  - playwright-core 在 node:20 阶段装好再拷进最终镜像，不装 Debian `npm`
  - 删 linuxserver s6 脚本；关电脑只停容器；换容器保留 `pibot-computer-data`
  - 5.17GB → 1.93GB；桌面 :3100、截屏、about:blank、工作区都还在
- Files created/modified:
  - bot-image/Dockerfile
  - bot-image/opt/pibot/bin/*.sh
  - bot-image/root/etc/supervisor/*
  - bot-image/root/usr/share/novnc/index.html
  - server/src/docker-manager.ts
  - server/src/computer-access.ts

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| 茶水间问好 | 大家好 | 有人 send_message 开口 | Judy/Ashford/蜻蜓队长都开口 | pass |
| 关电脑群聊 | 大家好，电脑关了也能聊吗 | 可见回复，不报 Bot offline | Judy/蜻蜓队长回答能聊、工具不行 | pass |
| Slice E 关电脑 | 电脑 offline + 在吗 | Bot 不 stopped，有回复 | 全员仍 online；Judy「在的。」 | pass |
| Slice E 开机工具 | 列 /config/workspace | 工具进容器 | bash 列出目录 | pass |
| 本机 MCP hub | stdio ping list/test/call | 不经容器 | list+test+pong | pass |
| Settings 测试 | POST /api/mcp/:id/test | connected，不开电脑 | last_status=connected | pass |
| 桌面截屏 | /desktop/screenshot | 有图 | 70KB png | pass |
| 浏览器 | navigate about:blank | 打开成功 | Title/URL 回来 | pass |
| 瘦身后镜像 | docker images | 小于 6.18GB | 5.17GB | pass |
| 瘦身后容器 | 无 pi/桥，有 node/chromium/scrot | 工作区还在 | workspace 目录在；8792 health ok | pass |
| 换底座镜像 | docker images | 2GB 级，无 webtop | 1.93GB | pass |
| 换底座桌面 | :3100 / vnc.html | 能开 | 200 + websockify 已连 VNC | pass |
| 换底座截屏 | /desktop/screenshot | 有图 | 35KB png | pass |
| 换底座浏览器 | navigate about:blank | 打开成功 | URL about:blank | pass |
| 换底座卷 | ls /config/workspace | 旧目录还在 | pi-agent-report 等 5 项 | pass |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
|           |       | 1       |            |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | webtop 已换成自建 Debian 桌面（1.93GB） |
| Where am I going? | 桌面已收成深色壁纸 + 底栏三图标 |
| What's the goal? | 脑子和 MCP 在本机，容器只当电脑 |
| What have I learned? | See findings.md |
| What have I done? | 1:1 + 群本机 SDK；MCP 本机；浏览器/截屏走容器薄服务 |
