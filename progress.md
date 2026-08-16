# Progress Log

## Session: 2026-08-16（自然回应 + 第二批缺陷）

### Phase 1: 提示词与结构化 pass
- **Status:** complete
- Actions taken:
  - 主持人 SYSTEM 改为按消息期待的开口人数邀请，语域从 work group 放宽
  - 成员 prompt：有话就说、未 @ 不要全员 pass、用用户的语言；干活指引保留但不绝对化
  - send_message 增加 `pass`；interceptTool 优先看该字段
- Files: server/src/moderator.ts, server/src/group-chat.ts, server/src/bot-manager.ts, bot-image/opt/pibot/extensions/pibot.ts

### Phase 2: 上一轮缺陷
- **Status:** complete
- Actions taken:
  - resolveMembersByNames 按 names 输入顺序去重
  - 救场：rescued + 排除 lastSpeakerId，每人一次
  - interceptTool 单回合硬顶 8
  - ComputerPanel 还原 `[bot?.id]` + oxlint-disable
- Files: server/src/group-chat.ts, server/src/groups.ts, server/src/bot-manager.ts, web/src/components/ComputerPanel.tsx

### Phase 3: 调查与清理
- **Status:** complete
- Actions taken:
  - 遗留群 27149a6c / a6642635 复查时已不在列表
  - 查清 stopBot / setModel / WS close / 容器重启路径，见 findings
  - intended=true 且 status 非 stopped 时改写成 stopped（不自动拉起）
  - docker cp 扩展；stop/start 三个 Bot；新 pi 7672/7673/7674
- 镜像：改了 `bot-image/`，**新容器需要重建镜像**才带上 `pass`。现有容器已 docker cp。

### Phase 4: 验证与提交
- **Status:** complete
- Actions taken:
  - build + lint 通过
  - 三个场景 + 茶水间重跑问候；私聊 pong；abort main 未杀群轮
  - 删除临时群，清理测试 md

## Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| tsc + vite + oxlint | 通过、无警告 | 通过 | ✓ |
| 容器扩展含 pass | 有 pass: | 有 | ✓ |
| 3 个 pi | 重启后可见 | 7672/7673/7674 | ✓ |
| 大家好（茶水间） | 多人中文问候，无沉默正文 | 三人问候 | ✓ |
| 大家好（verify 群名） | — | 被带跑去写 md | 污染，已重跑 |
| 指定 Judy 写文件 | 只有 Judy 动手 | 只有 Judy | ✓ |
| 开放讨论 | 多人表态 | 三人中文表态 | ✓ |
| 私聊 pong | 不受影响 | pong | ✓ |
| abort main | 不误杀群轮 | 讨论仍完成 | ✓ |
| 8 条上限 / 救场轮询 / next 顺序 | — | 没构造场景 | 没验证 |
| intended 假 online | — | 本次 pi 未退出 | 没验证 |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 16:36 | 「大家好」在群名 tmp-natural-verify 下变成写文件 | 1 | 换群名「茶水间」并清测试文件后重跑 |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | 验证完成，待提交 |
| Where am I going? | 独立提交本轮 |
| What's the goal? | 非任务也开口；pass 结构化；修 4 个缺陷 |
| What have I learned? | 群名/残留任务会让 Bot 把问候当干活；不要用词表纠正 |
| What have I done? | 见上 |
