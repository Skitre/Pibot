# Findings: 群聊编排重构

## Requirements
- 群内工具步骤、产出文件、发言即时可见且刷新后仍在
- send_message 增加 next / done 结构化交接
- 删除正则猜意图，改 LLM 主持人兜底
- 三重预算 + 每条停止路径写系统行
- 群聊 Composer 打开附件上传
- 更新 README / FEATURES
- 执行保持串行；私聊不受影响

## Research Findings
- `group_messages` 现有列：group_id, bot_id, author, content, kind, created_at。**没有 meta**。WorkLog / FileCard 需要 meta JSON，必须加列。
- `saveMessage` 在 `inGroupSession` 时直接 return，群内 tool/file 不会进 1:1（应保持），但目前也不进 group_messages。
- `publishProducedFiles` 对群会话直接 return，产出文件被丢弃。
- `tool_execution_start/end` 被 `inGroupSession` 门禁；前端 store **没有**处理 `type:"tool"`，私聊工具卡来自落库的 `kind=tool` 消息。群内同样应落 `group_messages` 再广播 `group_message`。
- `send_message` 只攒进 `live.groupSends`，等 `finishGroupMemberTurn` → `runOneTurn` 才 `saveGroupMessage`。
- `takeGroupPosts`：调过 send_message 就不用 lastAssistantText；计划改为「整轮没调过任何工具才兜底」。
- `countMemberPosts` 目前把非 system 都算进去。加入 tool/file 后必须只数 text/handoff，否则预算会被工具卡吃光。
- FileCard 用 `api.fileUrl(bot_id, path)`。用户附件 `bot_id=null`，需 `/api/files` 读共享 workspace。`uploadAttachment` 已写共享 workspace，botId 未使用。
- `test()` 三分支：anthropic-messages `/v1/messages`、openai-responses `/responses`、否则 `/chat/completions`。主持人 `complete()` 复用，不带 reasoning，max_tokens 小。
- 容器名 `pibot-computer-shared`；扩展路径 `/opt/pibot/extensions/pibot.ts`。部署：docker cp + 重启电脑，并 `npm run image`。
- 用户新消息只 `bots.abortGroup`，不写 Stopped；停止按钮走 `groups.abortGroup` 才写 Stopped。保持这个区分。
- 前端 `tool` 事件目前无消费者；带 channel 广播即可，可见性靠落库。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| group_messages 增加 meta | 与私聊 messages 对齐，WorkLog/FileCard 可复用 |
| send_message / message_teammate / update_memory 不落 tool 卡 | 发言已是气泡，转交已是 handoff，避免重复噪音 |
| 只数 text/handoff 为成员条数 | tool/file 是进度，不是发言 |
| 用户 @ 只决定本轮第一批；成员 next/done 之后优先于剩余批次 | 三层优先级：用户指令 > Bot 交接 > 主持人 |
| 用户 @ A,B 时跑完整批，除非有人 done（立刻停）或 next（下轮用最后一次 next） | 显式 @ 要兑现；done 表示任务结束 |
| 防连选只作用于主持人/Bot next，不作用于用户 @ | 用户点名同一人应照做 |
| 轮外 handoff 用转交正文里的 @ 作第一批 | 否则无用户 @，会立刻打主持人 |
| 预算：40 条成员发言 / 12 次主持人 / 20 分钟 | 计划未给数字；比旧 100 条更贴合干活，仍防死循环 |
| 群附件走 POST /api/groups/:gid/upload + GET /api/files | workspace 共享；FileCard 在 bot_id 为空时用 /api/files |
| complete() 默认档案、不带 reasoning、max_tokens=256 | 主持人只要短 JSON |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
|       |            |

## Resources
- server/src/bot-manager.ts
- server/src/groups.ts
- server/src/group-chat.ts
- server/src/model-profiles.ts
- bot-image/opt/pibot/extensions/pibot.ts
- web/src/components/GroupChatView.tsx
- web/src/components/Messages.tsx
- README.md
- design-refs/FEATURES.md
