# Task Plan: 群聊编排缺陷修复与真实验证

## Goal
修复群聊编排重构的 5 个缺陷（P0×2、P1×3、P2 死代码），让 Bot 真正跑起来，并用 Judy / Ashford / 蜻蜓队长做端到端验证。

## Current Phase
Phase 3: 真实运行验证（完成，待提交）

## Phases

### Phase 0: git 基线
- [x] git init
- [x] 基线提交（修复前的当前树）
- **Status:** complete

### Phase 1: 修缺陷
- [x] P0-1：落库条数、编排器条数、信号提取范围三者一致；next/done 不因截断丢失
- [x] P0-2：本轮发言数为 0 时主持人 done 不得收工，降级挑人
- [x] P1-1A：askModerator 打 source/reason/next 日志
- [x] P1-1B：主持人 maxTokens=512，实测 complete() 能拿到完整 JSON
- [x] P1-2：userTask 从全量 chatLines 取
- [x] P1-3：多个 next 合并去重，保持花名册顺序
- [x] P2：清理 fallback / previewLine / 无用 tool 广播
- **Status:** complete

### Phase 2: 构建与部署
- [x] npm run build 通过
- [x] npm run lint --workspace web 无警告
- [x] 确认容器内 pibot.ts 含 next/done；本轮无需 docker cp
- **Status:** complete

### Phase 3: 真实运行验证
- [x] 容器内有 pi 进程；补上 attachBridgeIfNeeded / connected 漏拉会话
- [x] 临时群跑分工任务：工具卡、文件卡、next 驱动、系统行收尾
- [x] 无 @ 提问至少一人回答（P0-2 的用户可见结果）
- [x] 私聊与私聊停止不误杀群轮次
- [x] 删除临时群
- [ ] 修复作为独立提交
- **Status:** in_progress

## Key Questions
1. P0-1 用拦截第 3 次 send_message，还是取消条数上限扫全量？
2. 为什么容器里没有 pi 进程？
3. complete() 在 deepseek-v4-flash 上能否返回完整 JSON？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 先 git init 再改代码 | 用户要求：项目不是仓库，改错无法回滚 |
| 修复作为独立于基线的第二次提交 | 用户要求 |
| P0-1 取消硬截断、扫全量 | 即时落库已写出第 3 条；截断会丢 next/done |
| 电脑重启后补拉 start_bot | bridge 实例还在时旧逻辑直接 return |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| DELETE 空 JSON body 被 Fastify 拒绝 | 1 | 无 body 删除；群已不在列表 |
| 主持人误判 done 的降级分支没跑到 | 1 | 如实记「没验证」 |

## Notes
- 不要重建镜像/容器，除非必要（本轮未重建）
- 不要动私聊、MCP、审批、记忆
- 没验证到的项必须写「没验证」
