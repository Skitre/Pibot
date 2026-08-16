# Progress Log

## Session: 2026-08-16

### Phase 1: 群内干活可见
- **Status:** complete
- **Started:** 2026-08-16 15:32
- Actions taken:
  - group_messages 增加 meta 列
  - 去掉 tool 事件 inGroupSession 门禁，广播带 channel
  - 群内 tool/file 落 group_messages；send_message 即时落库
  - 仅未调用任何工具时用 lastAssistantText 兜底
  - GroupChatView 复用 WorkLog / FileCard
- Files created/modified:
  - server/src/db.ts
  - server/src/bot-manager.ts
  - server/src/groups.ts
  - web/src/components/GroupChatView.tsx
  - web/src/components/Messages.tsx
  - web/src/types.ts
  - web/src/store.ts

### Phase 2: 结构化交接信号
- **Status:** complete
- Actions taken:
  - send_message 增加 next / done，描述改为干活导向
  - groupSends 升级为 GroupPost
  - docker cp 进 pibot-computer-shared
- Files created/modified:
  - bot-image/opt/pibot/extensions/pibot.ts
  - server/src/group-chat.ts
  - server/src/bot-manager.ts

### Phase 3: LLM 主持人 + 拆掉正则
- **Status:** complete
- Actions taken:
  - model-profiles.complete() 三分支，不带 reasoning
  - 新增 moderator.ts：名字校验、防连选、失败回退
  - 删除 isWrapUpMessage / isContinueCue 等启发式；resolveResponders 只处理显式 @
  - 重写 runGroupTurn：显式 TurnState，批次快照，不再边遍历边 push
- Files created/modified:
  - server/src/model-profiles.ts
  - server/src/moderator.ts
  - server/src/group-chat.ts
  - server/src/groups.ts

### Phase 4: 终止条件、附件与文档
- **Status:** complete
- Actions taken:
  - 预算 40 条 / 12 次主持人 / 20 分钟，停止路径写系统行
  - Composer 打开附件；POST /api/groups/:gid/upload；GET /api/files
  - 更新 README、FEATURES、群提示文案
- Files created/modified:
  - server/src/index.ts
  - web/src/api.ts
  - web/src/i18n.ts
  - README.md
  - design-refs/FEATURES.md

### Phase 5: 验证
- **Status:** complete
- Actions taken:
  - server/web tsc 通过；web lint 仅有既有 ComputerPanel warning
  - /api/files 已在运行中的宿主生效
  - 共享电脑已重启且 online；容器内扩展含 next/done
  - `pibot-computer:latest` 已重建

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| tsc server | npm run build --workspace server | 通过 | 通过 | ✓ |
| tsc+vite web | npm run build --workspace web | 通过 | 通过 | ✓ |
| oxlint web | npm run lint --workspace web | 无新增 | 仅 ComputerPanel 既有 warning | ✓ |
| /api/files | path=missing | file not found | 404 file not found | ✓ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
|           |       | 1       |            |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 5 验证：电脑重启 + 镜像重建 |
| Where am I going? | 镜像重建完成；真实群聊分工留给用户跑 |
| What's the goal? | 结构化交接 + LLM 主持人兜底 + 群内干活可见 |
| What have I learned? | See findings.md |
| What have I done? | 四阶段代码已落地，构建通过 |
