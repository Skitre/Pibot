# Task Plan: 群聊自然回应 + 第二批缺陷

## Goal
让群聊在非任务场景下也能自然开口（不靠关键词分类），把 pass 做成结构化参数，并修上一轮引入的 4 个缺陷。真实跑三个场景后删临时群。

## Current Phase
Phase 4: 验证与提交

## Phases

### Phase 1: 提示词与结构化 pass
- [x] 主持人 SYSTEM 放宽
- [x] 成员 prompt 松绑
- [x] send_message 增加 pass 字段
- **Status:** complete

### Phase 2: 上一轮缺陷
- [x] resolveMembersByNames 按 names 输入顺序
- [x] 救场排除 lastSpeaker，每人最多一次
- [x] interceptTool 单回合硬顶 8 条
- [x] ComputerPanel 还原为按 bot id 拉 routines
- **Status:** complete

### Phase 3: 调查与清理
- [x] 遗留测试群已不在列表
- [x] pi 消失路径写入 findings
- [x] docker cp 扩展并重启 pi
- **Status:** complete

### Phase 4: 验证与提交
- [x] build + lint
- [x] 三个场景真实跑并记录 transcript
- [x] 私聊回归；删临时群和测试文件
- [ ] 独立提交
- **Status:** in_progress

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 不引入问候/社交词表 | 用户硬性约束 |
| pass 结构化优先 | 模型会把「我保持沉默」写成正文 |
| intended=true 只纠 status，不自动拉起 | 避免用户停掉的 Bot 复活 |
| 「大家好」用群名「茶水间」重跑 | verify 群名会把问候带成写文件 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| 群名 tmp-natural-verify 下「大家好」变成写 md | 1 | 换茶水间重跑 |

## Notes
- 改了 bot-image：现有容器已 docker cp；新容器需重建镜像
- 不要动私聊 / MCP / 审批 / 记忆
