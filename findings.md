# Findings: 群聊编排缺陷修复与真实验证

## Requirements
- 修 P0-1 / P0-2 / P1-1 / P1-2 / P1-3 / P2
- 落库条数、编排器 posts、信号提取范围三者一致
- 本轮成员发言数为 0 时，主持人 done 不得收工
- 主持人 source 可观测；complete() 实测能拿到完整 JSON
- userTask 从全量 transcript 取；多个 next 合并去重
- 真实跑 Bot：容器内有 pi 进程；临时群分工后删除
- 没验证到的项必须写「没验证」

## Research Findings
- `takeGroupPosts` 截断到 2 条，但 `interceptTool` 对每次非 pass `send_message` 都即时落库。第 3 条的 `next`/`done` 会被 `lastPostSignal` 漏掉，房间里却已经有这条消息。
- 主持人首轮 `queue` 为空时，`decision.done` 会直接 `stopWith("Task complete.")`，用户看不到任何 Bot 发言。
- `ModeratorDecision.source` 从未被读取；`complete()` 默认 `maxTokens: 256`，档案 `deepseek-v4-flash` 是 `reasoning: 1 / thinking: high`。
- `state.userTask = latestUserTask(opening)`，handoff 切片遇用户消息就 break，转交起轮时 task 为空。
- `lastPostSignal` 与 `runGroupTurn` 的 `lastNext` 都是覆盖赋值。
- `attachBridgeIfNeeded` 在 `this.bridge` 已存在时直接 return。电脑重启后只 `dropAllLive`，不会再 `start_bot`。`startBot` 在桥里对已有进程是 no-op。
- 前端 `store.ts` 没有 `case "tool"`。群内工具可见性靠 `emitGroupPersist(..., "tool")` → `group_message`。
- `listGroups` SQL 已过滤 tool；`previewLine(..., "tool")` 调用处不存在。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| P0-1 取消 `takeGroupPosts` 硬截断，扫全量 | 即时落库已经把第 3 条写进房间；截断会让落库 / posts / 信号三者不一致。软限制只写在提示词里。硬顶仍是 `GROUP_MAX_MEMBER_TURNS`。 |
| P0-2 仅保护主持人路径、且仅当 `speakCount` 合计为 0 | Bot 自己的 `done` 说明已经有人开口，不需要这道保护。 |
| 主持人 `maxTokens: 512` | 实测 85 字符完整 JSON 已够用；512 给推理预算留余量。 |
| `userTask` 改全量 `chatLines` | 只有 task 换全量；transcript 仍用 turn slice。 |
| `mergeNextNames` + 花名册顺序 `resolveMembersByNames` | 多个 next 合并去重，执行仍串行。 |
| `connected` 与 `attachBridgeIfNeeded` 补拉不在 `running` 里、且 status≠stopped 的会话 | 验证时发现这是「DB 显示 online、容器里没有 pi」的根因之一。 |
| 还原 `tool` 事件的 `inGroupSession` 门禁 | 前端不消费 `type:"tool"`；群内可见性走 `group_message`。 |
| ComputerPanel lint 把 deps 改成 `[bot]` | `npm run lint --workspace web` 要求无警告；只改这一处。 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 电脑重启后 `this.bridge` 仍在，不再 `start_bot` | `attachBridgeIfNeeded` 已有实例时补拉会话；`connected` 对不在 `running` 里的 Bot 再 `start_bot` |
| e2e DELETE 带了 `content-type: application/json` 空 body，Fastify 415/400 | 改用无 body 的 DELETE；临时群已不在 `/api/groups` 列表 |
| PowerShell 控制台把中文 Bot 名打成乱码 | 用 node / docker 侧 UTF-8 核对 |

## P1-1B 实测（2026-08-16）
用默认档案 `opencode` / `deepseek-v4-flash`（`api=openai-completions`, `reasoning=1`, `thinking=high`）走 `ModelProfileStore.complete(..., { maxTokens: 512 })`：

- HTTP 200，`choices[0].message.content` 长度 85
- 原文：`{"next":["Judy"],"done":false,"reason":"Judy should create the short md file first."}`
- 推理内容**没有**混进 `content`；花括号提取得到完整 JSON，`JSON.parse` 成功
- 同一输入再走 `moderate()`：`source=llm`，`next=["Judy"]`
- 因此**没有**改 `parseDecision`

## 真实验证（2026-08-16 16:14）
容器 `pibot-computer-shared` 内有 3 个 `pi` 进程。Judy / Ashford / 蜻蜓队长 status=online。容器扩展 `/opt/pibot/extensions/pibot.ts` 含 `next` / `done`。本轮未改 `bot-image/`，未重建镜像。

临时群 `bc8dfe6f`（tmp-verify-group），任务：Judy 写 md → Ashford 补充 → 蜻蜓队长复核收尾。

| 项 | 结果 |
|----|------|
| 工具卡 / 文件卡 | 看到 `kind=tool`（write/read/edit）和 `kind=file`（`tmp-group-verify.md`） |
| 交接是否由 next 驱动 | **第一轮没有打主持人**。发言顺序 Judy → Ashford → 蜻蜓队长，最后系统行 `Task complete.`。服务端直到无 @ 追问才出现 `moderator source=llm`。 |
| 收尾系统行 | 两轮都有 `System / Task complete.` |
| 无 @ 提问（P0-2 用户可见结果） | 主持人 `source=llm next=[Judy]`，Judy 回答「3 节」 |
| 主持人误判 done、发言数 0 的降级分支 | **没验证**（这次主持人没有返回 done） |
| 单回合 3 条 send_message 截断 | **没验证**（每人本回合只发了 1 条房间消息） |
| 同批两个不同 next 合并 | **没验证**（每批只有一人） |
| handoff 起轮 userTask | **没验证**（这次是用户开口，不是轮外 handoff） |
| 私聊 | Judy 私聊「只回复一个词：pong」→ 回复 `pong` |
| 私聊停止不误杀群轮 | 群轮进行中对 Judy 发了 `abort channel=main`，三人仍依次做完 |
| 临时群 | 已从 `/api/groups` 消失；workspace 里的 `tmp-group-verify.md` 已删 |

## Resources
- server/src/group-chat.ts
- server/src/groups.ts
- server/src/moderator.ts
- server/src/bot-manager.ts
- web/src/components/ComputerPanel.tsx
