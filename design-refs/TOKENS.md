# Grok Bot UI 设计基线（像素级复刻参照）

来源素材（均在本目录）：
- `screenshot-lennysan.jpg` — macOS 版深色模式完整截图（主参照）
- `frames-usage/f003 f005 f008 f011 f015 f018 f022.jpg` — Windows 版录屏抽帧（三栏布局、卡片、指示器细节）
- `frames-launch/*.jpg` — 官方发布视频抽帧（浅色模式、composer 细节、iOS 版）
- `icon-frame1/2.jpg` — 官方图标：黑色圆球 blob + 两个白色椭圆眼睛；待机时可变形为三个点

> 标注 [推断] 的条目为素材中无法精确测量、按设计语言补全的值。

## 1. 总体布局（桌面端）

三栏结构，整窗深色、无系统标题栏（自绘窗口控制）：

| 区域 | 宽度 | 说明 |
|---|---|---|
| 左侧边栏 | 260px（macOS 截图约 300/1024*视窗）[推断 260] | Bot 会话列表 |
| 中间会话区 | 弹性 | 消息线程 + composer |
| 右侧面板 | 300px [推断] | "Bot's screen" 缩略图 + Routines；可整体收起 |

- 窗口圆角 ~12px，背景分层：侧栏 `#1b1b1d`，会话区 `#101012`（比侧栏更深），右面板与会话区同色
- 顶部：侧栏内左上角红绿灯(mac)/右上角最小化最大化关闭(win)；会话区顶栏高 ~52px，左侧 Bot 头像(24px)+名称(15px/600)，右侧图标按钮：屏幕面板开关（显示器图标）、设置齿轮

## 2. 颜色 token（深色模式）

```
--bg-sidebar:      #1B1B1D   侧栏底
--bg-main:         #0F0F10   会话区底
--bg-bubble-bot:   #232326   助手气泡（带 1px #2E2E31 描边）
--bg-bubble-user:  #3A3A3E   用户气泡（明显更浅的灰）
--bg-input:        #202023   composer/搜索框底
--bg-hover:        #29292C   列表项 hover/选中
--text-primary:    #E8E8EA
--text-secondary:  #8E8E93   时间戳、预览、系统提示
--text-placeholder:#6E6E73
--accent-blue:     #3B82F6   打字指示、发送按钮、链接 [推断色值]
--green-dot:       #30D158   需要关注/在线指示点
--code-pink:       #E75480   行内代码文字 [推断]，底 #3A2A30
--border-subtle:   #2E2E31
```

浅色模式存在（发布视频），MVP 只做深色。

## 3. 字体排印

- 字体族：Inter（官方用 Inter/系统 grotesque），回退 `-apple-system, "Segoe UI", sans-serif`
- 消息正文 14px/1.45；会话列表名称 14px/600；预览与时间戳 12px/400 `--text-secondary`
- 日期分隔线："Today 11:15 PM" 居中 11px `--text-secondary`
- 系统提示（"Grok Bot can run commands on your computer this time."）居中 11px `--text-secondary`

## 4. 组件规格

### 4.1 侧栏
- 顶部 "+"（新建 Bot）图标按钮 28px，右上角
- 搜索框：高 32px、圆角 8px、`--bg-input` 底、放大镜图标 + "Search" 占位
- 列表项：高 ~64px、圆角 10px、内边距 10px；头像 40px 圆形彩色 blob 脸；第一行 名称+右对齐时间戳；第二行 最后消息预览单行截断；需要关注时头像左下角绿点 8px
- 底部固定：`Hidden chats 1 >` 行、分隔、`Plugins`（插头图标）、用户行（头像缩写圆 + 姓名 + 右侧蓝色圆形升级按钮）

### 4.2 消息区（iMessage 式但左右都是灰系）
- 助手气泡：左对齐，`--bg-bubble-bot` + 描边，圆角 16px（连续消息角部收窄 4px），最大宽度 ~72%
- 用户气泡：右对齐 `--bg-bubble-user`，无描边
- 气泡内 markdown：行内代码 = 粉红色 mono 文字 + 深色 chip 底、圆角 4px；列表、粗体正常渲染
- 悬停操作（气泡右侧竖排三个 16px 图标）：表情回应、引用回复、更多 "…"
- 内嵌提问卡片（bot 问题 + 内联输入）：气泡内标题 14px/600，下方内嵌输入 pill（`--bg-input`、占位文字、右侧 ✓ 提交）；用于审批/选择时输入区替换为选项按钮
- 事件行：居中灰字（如 "Renamed to Talent Matchmaker"）
- 打字指示：左下角蓝色圆点 blob（8→10px 呼吸动画），流式中显示 "`{Bot} is working`"（头像+文字，文字带渐隐动画）

### 4.3 Composer
- 药丸形，高 44px，圆角 22px，`--bg-input` 底 + 1px 描边
- 左端内嵌 "+" 圆钮 28px（附件），占位 "Message {BotName}"
- 右端：空态 = 麦克风圆钮；有文字 = 黑底白箭头(浅色模式)/白底黑箭头(深色) 发送圆钮 32px [浅色模式素材确认，深色推断反色]

### 4.4 右侧面板（Bot's screen + Routines）
- 顶部 16:10 缩略图卡片（圆角 8px）实时显示 Bot 桌面，下方居中标注 "{Bot}'s screen" 11px 灰
- 中部说明文字："Routines are recurring tasks this agent runs on a schedule."（居中、灰、12px）
- "Create Routine" 按钮：`--bg-hover` 底、圆角 8px、13px 白字
- 面板头右侧：齿轮 + X（关闭面板）

### 4.5 Bot 图标/头像体系
- 官方图标：黑圆球 + 两个白椭圆眼（偏右上视线），状态间平滑变形（三点 ⇄ 球 ⇄ 表情）
- 会话头像：彩色圆底（橙/粉/紫/蓝等）+ 白/黑 blob 脸；本项目用 SVG 代码绘制，色板：#F59E0B #EC4899 #8B5CF6 #3B82F6 #10B981

## 5. 交互要点

- 消息发送后立即入列表，Bot 回复流式逐字渲染
- Bot 执行工具时中间区显示 "is working" 状态行；系统提示行告知权限类事件
- 审批（extension_ui_request）渲染为内嵌卡片：confirm → 两个按钮；select → 选项列表；input → 内联输入 pill
- 右面板缩略图点击放大为全屏 noVNC 交互视图（"You're in control" 顶栏状态）
