# Grok Bot 功能全景与使用链路（复刻对照基线）

> 调研时间：2026-08-13。来源：docs.x.ai/grok-bot 全部文档页（overview / get-started /
> bots / computer-and-apps / files-and-results / chat-and-collaboration /
> skills-routines-and-automations / settings-and-notifications /
> approvals-security-and-privacy / troubleshooting）、x.ai/bot 产品页、
> x.ai/news/introducing-grok-bot 发布文，以及 VentureBeat / Unite.AI / MacRumors 报道。
> 状态列：✅ Pibot 已有 ｜ 🔶 部分实现 ｜ ❌ 未实现 ｜ ➖ 单机版不适用

## 0. 产品形态

- 2026-08-11 发布，早期 beta。桌面 macOS/Windows（无 Linux 桌面版）+ iOS，Android 在路上。
- 不单卖：绑 SuperGrok Heavy / Cursor Ultra($200/mo) / Cursor Teams Premium($120/seat)，企业走 waitlist。
- 登录用 Cursor 账号（OAuth 跳浏览器），要求云端数据存储（不支持 Legacy Privacy Mode）。
- 核心卖点：不用先搭 workflow，"像给同事发消息一样派活"；Bot 24/7 在云端干活，合上笔记本不停。

## 1. 核心对象模型

| 对象 | 官方定义 | Pibot |
|---|---|---|
| Bot | 有名字、职位(title)、描述、头像的常驻同事，各自独立会话与记忆 | ✅（无 title/头像编辑）|
| 共享云电脑 | **整个账户一台** VM（浏览器+文件系统+终端），所有 Bot 共享 cookie/文件/CLI 凭据；每个 Bot 有独立"屏幕"可并行操作 | ✅ 单容器共享桌面/登录态/工作区；每 Bot 独立 pi 会话 |
| 会话 | 一 Bot 一条长会话，支持消息回复(thread)、表情回应 | 🔶 私聊/每个群各一条 pi session；无消息回复/表情 |
| 群聊 | 2–6 个 Bot 一个线程，Bot 间自主传递工作 | ✅ 独立线程（不写私聊）；2–6；用户 @ 指定；send_message next/done 交接；LLM 主持人兜底；群内工具卡/文件卡/附件 |
| Skill | 可复用的"做事方法"说明书，跨 Bot 共享、可按 Bot 启用，`/` 引用 | ✅ |
| Routine | 定时（或事件触发）让某个 Bot 跑一个流程；每 Bot 上限 50 条，保留最近 20 次运行记录 | 🔶 有 cron+立即运行，无运行历史/Test run/事件触发 |
| Connector(Plugin) | 结构化对接服务（Marketplace + Yours），账户级安装，`@` 引用 | ➖/❌（侧栏有占位）|
| MCP server | 账户级接入本地 package 或远程工具服务 | ✅ stdio + Streamable HTTP/SSE；连接测试、工具开关、secret 脱敏、视觉结果适配 |
| 审批 & Auto-review | 审批卡片 + 规则引擎（Require Approval 优先于 Always Allow） | ✅ MCP server/工具级规则与 Auto/Ask/Allow 默认策略 |
| 记忆 | 偏好、事实、工作摘要；越用越懂（学写作口吻、边界、何时该打扰） | ✅ AGENTS.md：Preferences / Facts / Work 滚动摘要 |
| 配额上限 | Bot+群聊合计 ≤50；桌面单次附件 ≤6 个；文档/图片/音频 ≤25MB、视频 ≤200MB | 🔶 附件 25MB 已对齐 |

## 2. 使用链路（user journeys）

### 2.1 首次上手
下载安装 → Cursor 账号浏览器授权 → 引导页介绍 Bots/共享电脑/routines → 问"你用哪些工具"（只影响模板推荐）→ 后台建云电脑 → **Meet a future teammate** 模板挑选 或 Create your own（名字+一个主职责+工作方式描述）→ 派第一个任务。
- 文档建议第一个任务：附件一份文档让它总结（5 分钟出结果、不需要登录任何东西）。
- Pibot：✅ 创建模板/自建都有；❌ 无"问你用什么工具→推荐模板"的引导问卷。

### 2.2 日常对话
- 输入：文本/链接/图片粘贴、本地文件附件、`/` 引用 skill、`@` 提及 Bot/群/routine/connector、回复特定消息、表情回应。
- 工作中可继续发消息**转向**（steer），用户消息优先于后台任务；发 "Stop now" 立即停。
- transcript 里穿插：工具活动、电脑操作、生成的文件卡片、Bot 的提问、审批请求。
- Pibot：✅ steer/停止/工具卡/审批卡、`/` Skill 补全；❌ 回复消息、表情回应。

### 2.3 Bot 电脑
- 会话里开 **Agent Computer** 看实时桌面（点击、输入、导航、状态）。
- 敏感步骤**接管**：密码/passkey/2FA/CAPTCHA/支付/人机校验，自己输完还给 Bot；密码绝不进聊天。
- 支持的连接可用 **secure secret request**：掩码输入，不进 transcript、不给模型看。
- 登录态持久，一次登录所有 Bot 复用（因为电脑是共享的）。
- 电脑维护三级：Update（重建保数据）/ Recover（不可达时替换）/ Reset（回滚快照，可能丢近期数据）。
- 本地电脑执行是**独立能力**：Ask every time / Always / Never，默认每次询问。
- Pibot：✅ 面板+全屏接管（KasmVNC 天然支持接管）；❌ secure secret、电脑重建/恢复入口、本地执行策略（不适用）。

### 2.4 附件与结果
- 附件类型：图/音/视频、PDF/纯文本、Office 三件套、CSV/JSON/YAML/代码、HTML/邮件、Jupyter。
- 结果以**卡片**呈现：文件、图片、链接、工具结果；点开应用内预览，可保存/跳原链接/继续给反馈。
- 最佳实践：让 Bot 交付"可审查工件"（带来源链接的文档、定义好列的表格、未发送的草稿……），区分事实/假设/已完成/待审批/未决。
- Pibot：✅ 附件上传+图片预览+文件下载；✅ 私聊/群聊产出文件卡片；✅ 群内工具步骤可见。

### 2.5 Skill / Routine / 自动化
- 链路：先把一次性任务做可靠 → "把刚才的流程存成 skill 叫 XX" → 需要定时再建 routine。
- **Teach a task**（跟学）：开电脑视图 → 点 Teach a task → 说明要演示什么 → 演示一遍（录制可见操作 ≤10 分钟，不录音）→ 生成 skill 草稿 → 人工补决策规则/失败处理/审批边界 → 安全样例测试。灰度功能，没有按钮时可用文字让 Bot 从已完成任务提炼 skill。
- Routine 创建：自然语言（时间+skill+输出位置+禁止事项+缺数据策略），Bot 建好后显示下次运行时间。
- 事件触发：Cursor 账号集成（如 Slack 消息、GitHub 通知）触发 routine，要求窄匹配规则。
- 管理：View conversation details → Routines：启停/Test run/改排程/看成功失败历史/删除。长期不在线会询问是否继续跑，无响应则暂停。
- Pibot：✅ Skill 体系；🔶 routine CRUD+run now；❌ 跟学录制、事件触发、运行历史、Test run 语义。

### 2.6 多 Bot 协作
- 群聊：New → 选 2–6 个 Bot → 自动起名可改 → 描述共同目标和下一步归属。
- 消息路由：`@Bot` 指定；多 @；`@everyone` 慎用。没 @ 时由主持人看任务和进展点下一位。成员用 `send_message` 的 `next`/`done` 交接或收工。
- **Bot 间异步 DM**：一个 Bot 可以给另一个发消息，对方被唤醒处理后再回，handoff 在会话里可见。
- Bot→群消息目前纯文本（图要 DM 发）。
- **Duplicate Bot**：复制 profile/设置/启用的 skills/routines/头像，不复制会话历史与记忆。
- Pibot：✅ 群聊独立线程（不写 1:1）、每 Bot 每群一条 pi session、用户 @ / Bot next·done / 主持人兜底、群内工具卡与产出文件、附件上传、复制 Bot；❌ 群成员编辑。

### 2.7 审批与安全
- 审批卡片显示目标操作+参数；桌面按钮 Allow once / Deny / **Always allow**（存成规则）。
- **Auto-review** 规则（Settings → General）：Require Approval 规则永远拦；Always Allow 仅在自动审查没发现别的问题时放行；冲突时 Require 赢。
- 建议边界：发消息/发布/购买/删除/改权限/改生产 都要审批。
- Pibot：✅ MCP 审批卡、Always Allow / Require Approval 规则表和优先级；🔶 尚未覆盖所有内建工具。

### 2.8 设置与通知
- Settings（`Cmd/Ctrl+,`）分区：
  - General：账户、外观（Follow System/Light/Dark）、默认模型、**时区**（routine 用）、本地执行策略、Auto-review 规则。
  - Plugins：Marketplace / Yours，connector 工具可单独开关。
  - Usage & Billing：周度用量。➖
  - Team Setup：管理员托管初始化。➖
  - Beta：应用更新、Update/Reset Agent Computer。
- 单 Bot 设置（聊天顶栏齿轮 / 侧栏 Agent settings）：名字、职责、模型绑定、思考强度覆盖、Skill 开关。**每 Bot 通知开关**未做。
- 侧栏**注意状态**三分：Needs attention（提问/审批/handoff）、Unread activity（新结果）、working/typing；打开会话即已读，可手动标已读/未读。
- 通知：应用聚焦时抑制，dock/侧栏徽标仍显示；iOS 推送灰度中。
- 应用内错误通知中心：composer 上方，可逐条关闭/清空，带 Copy request ID。
- Pibot：✅ 设置页（Models/MCP/Approvals/Skills/General/About）、Bot 级 Agent settings（模型/思考/Skill）、桌面通知、未读与手动已读；❌ 浅色模式、时区设置、每 Bot 通知开关、错误通知中心。

### 2.9 搜索与导航
- 搜索/命令面板：切 Bot 和群、找历史消息、找文件/链接/routine、开设置、跳转到会话中匹配位置。
- 快捷键：`Cmd/Ctrl+N` 新建、`Cmd/Ctrl+,` 设置。
- Pibot：✅ Ctrl+K 命令面板和消息搜索；🔶 尚未索引文件/链接/routine。

## 3. 建议的下一步优先级（差距 × 单机价值）

1. **Skill 体系 + `/` `@` 补全**：skill=workspace 里的 markdown 方法库，per-Bot 启用，composer 输入 `/` 弹菜单 —— 官方"越用越顺手"的关键载体。
2. **未读/需要关注状态**：侧栏三态（工作中蓝点已有/需要关注绿点已有/未读加粗+徽标），手动标已读。
3. **消息回复(引用) + 表情回应**：官方对话链路的基础件。
4. **命令面板（Ctrl+K）+ 全文搜索**：SQLite FTS 即可。
5. **Bot 间 1:1 DM 唤醒 + Duplicate Bot**。
6. **审批 Always allow / 规则表**（简化版 Auto-review）。
7. **Routine 运行历史 + Test run**。
8. **Bot 产出文件卡片化**：扫描 workspace 新文件 → 会话内卡片预览/下载。
9. **浅色模式 + Follow System**。
10. **Teach a task（跟学）**：录制接管期间的浏览器事件 → 让模型提炼成 skill 草稿。工程量最大，放最后。
