# Pibot

本机单用户版 Grok Bot 复刻：一组共用一台电脑的常驻 AI 同事。大脑层基于 [pi-sdk](https://github.com/earendil-works/pi)（`@earendil-works/pi-coding-agent`），所有 Bot 共用一个 Docker 容器（Linux 桌面 + Chromium + KasmVNC），Web UI 按官方应用像素级还原。

## 架构

对齐官方："整个账户一台共享电脑"。所有 Bot 的 pi 进程跑在同一个容器里，
共享桌面、Chromium 登录态和 `/config/workspace` 文件；每个 Bot 有私有目录
`/config/bots/<id>/`（记忆 AGENTS.md、模型配置、pi 会话状态）。

```
浏览器 Web UI (React+Vite, 5190)
   │  WebSocket / REST
宿主 Node 服务 server/ (Fastify, 8790)
   │  ws://桥接端口 (botId 多路复用 ⇄ pi RPC JSONL)
共享电脑容器 pibot-computer-shared（一台，所有 Bot 共用）
   ├─ bridge.mjs             ← 多路复用：每 Bot 拉起/管理一个 pi 进程
   ├─ pi --mode rpc × N      ← 每 Bot 一个大脑（HOME=/config/bots/<id>）
   ├─ XFCE 桌面 + KasmVNC    ← 共享屏幕，UI 内嵌观看/接管
   ├─ Chromium (CDP 9222)    ← 共享浏览器：登录一次全员可用
   └─ /config/workspace      ← 共享工作区：附件、Bot 间文件交接
```

## 先决条件

- Windows + Docker Desktop（WSL2）、Node ≥ 20
- 一个第三方模型中转 API（支持 anthropic-messages / openai-completions / openai-responses 任一格式）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 构建 Bot 容器镜像（首次较慢）
npm run image

# 3. 配置模型中转（复制模板后填 baseUrl / apiKey / 模型名）
copy server\config.example.json server\config.json

# 4. 启动服务端 + 前端
npm run dev        # server: http://localhost:8790
npm run dev:web    # web:    http://localhost:5190
```

打开 http://localhost:5190，点击左上角 "+" 创建第一个 Bot。
（端口固定为 5190 且 `strictPort`，被占用时会直接报错而不是漂移到别的端口。）

## 目录

- `design-refs/` — 官方 UI 参照素材与设计基线（TOKENS.md）
- `server/` — 编排服务：Bot 生命周期、pi RPC 桥、WebSocket 网关、例行任务、SQLite
- `bot-image/` — Bot 容器镜像：桌面、Chromium、pi、自定义工具扩展
- `web/` — Web UI（像素级还原 Grok Bot 桌面端）

## 功能对照

| Grok Bot | Pibot 实现 |
|---|---|
| 账户一台共享云电脑 | 一台共享容器，KasmVNC 网页桌面内嵌 UI；登录态/文件全 Bot 共享 |
| 登录工具像人一样操作 | 容器内 Chromium + Playwright(CDP) 工具，桌面可见 |
| 文本模型使用电脑 | 模型档案可关闭视觉；网页操作自动回传 DOM 文本快照，截图可指定另一视觉模型转述，失败时回退文本 |
| MCP 扩展 | Settings → MCP 管理账户级 stdio / HTTP server；支持连接测试、工具发现/逐项禁用、secret 脱敏和热更新，图片结果自动适配文本/视觉模型 |
| MCP 审批 | Auto / Ask / Allow 默认策略；server/工具级 Require Approval 与 Always Allow，Require 永远优先 |
| 消息式交互/流式回复 | pi RPC 事件流 → WebSocket → UI |
| 审批打断 | pi 扩展 UI 协议 → 内嵌审批卡片 |
| 例行任务 | node-cron 定时向 Bot 发 prompt |

### 添加 MCP package

在 `Settings → MCP → Add MCP server` 选择 `stdio`。npm package 通常填写：

- Command：`npx`
- Arguments：每行一个参数，例如 `-y`、`@scope/package`
- Environment：该 MCP 所需的环境变量 JSON

stdio 命令在共享电脑容器内运行。只添加可信 package。保存后点击 **Test connection**
发现工具，可逐项禁用；在 **Settings → Approvals** 配置 Require Approval / Always Allow。
Auto 策略会放行 MCP 标注的只读工具，写入或未知工具会在聊天中弹审批卡。
| 记忆/越用越懂你 | AGENTS.md：Preferences / Facts / Work；update_memory 分类；干完活后自动记工作摘要 |
| 多 Bot 群聊协作 | 独立群线程 + 每线程一条 pi session + 用户 @ / Bot next·done 交接 + LLM 主持人兜底；群内可见工具卡、产出文件和附件 |
| 发送文件/图片给 Bot | Composer 附件（点 +、拖拽、粘贴）→ 存进 Bot 电脑 workspace，聊天内预览 |
| 中断正在工作的 Bot | 生成中 composer 显示停止按钮（abort） |
| 重命名/调整 Bot | 聊天顶栏齿轮或侧栏「Agent 设置」：名称、职责、模型绑定、思考强度覆盖、Skill 开关；改名同步容器 AGENTS.md |
| 查看/编辑 Bot 记忆 | Memory 弹窗直接读写容器内 AGENTS.md |
| 消息操作 | 气泡悬停复制；侧栏菜单可清空会话（保留记忆） |
| 桌面通知 | 审批请求/任务完成且页面不在前台时系统通知（设置页开关） |
| 跟学录制屏幕 | 未实现；用"对话中让 Bot 把流程存为 routine"替代 |

## 注意事项

- **务必用 `localhost` 访问 UI**。Bot 电脑面板内嵌的 KasmVNC 要求"安全上下文"：
  `http://localhost` 满足，换成局域网 IP 或其他主机名访问时，面板会显示
  "application requires a secure connection (HTTPS)"，桌面画面出不来。
- Docker Desktop 未运行时，宿主服务和聊天 UI 仍会降级启动，电脑面板显示“电脑离线”。
  启动 Docker Desktop 后点击离线电脑卡片即可重试，无需重启前后端服务。
- 容器内的脚本必须是 LF 行尾（仓库已通过 `.gitattributes` 约束，镜像构建时也会再规范化一次）。
- 模型不通时，Bot 不会沉默：失败原因会作为系统消息显示在会话里
  （例如 `No API key found` 或 `Connection error.`），据此排查中转配置。
