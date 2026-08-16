# Progress Log

## Session: 2026-08-16（缺陷修复与真实验证）

### Phase 0: git 基线
- **Status:** complete
- Actions taken:
  - `git init`，基线提交 `cbe4123`

### Phase 1: 修缺陷
- **Status:** complete
- **Started:** 2026-08-16 16:07
- Actions taken:
  - P0-1：`takeGroupPosts` 不再 slice；提示词改为软限制；注释写明与即时落库对齐
  - P0-2：主持人 done 且本轮发言数为 0 时降级挑人
  - P1-1A：`askModerator` 打 `source` / `next` / `reason`
  - P1-1B：主持人 `maxTokens: 512`；实测 complete() 返回完整 JSON
  - P1-2：`userTask` 改从全量 `chatLines` 取
  - P1-3：`mergeNextNames`；`lastNext` 合并；`resolveMembersByNames` 按花名册顺序
  - P2：简化 `fallback`；删掉 `previewLine` 的 kind；还原 `tool` 事件门禁
  - 顺带：`attachBridgeIfNeeded` / `connected` 补拉缺失 pi 会话（否则验证跑不起来）
  - ComputerPanel lint：deps 改为 `[bot]`
- Files created/modified:
  - server/src/group-chat.ts
  - server/src/groups.ts
  - server/src/moderator.ts
  - server/src/bot-manager.ts
  - web/src/components/ComputerPanel.tsx

### Phase 2: 构建与部署
- **Status:** complete
- Actions taken:
  - `npm run build`（server + web）通过
  - `npm run lint --workspace web` 无警告
  - 容器内扩展已含 next/done；本轮未改扩展，未 docker cp，未重建镜像

### Phase 3: 真实运行验证
- **Status:** complete
- Actions taken:
  - 重启宿主 tsx 进程加载新代码；电脑保持原容器
  - `ps` 看到 3 个 pi；三个 Bot online
  - 临时群 `bc8dfe6f` 跑完分工后删除；删了 workspace 测试文件
  - 私聊 pong 成功；群轮中 abort main 未中断群聊
- 没验证：单回合 3 条 send_message、同批双 next、handoff 起轮 userTask、主持人误判 done 的降级分支

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| tsc server | npm run build --workspace server | 通过 | 通过 | ✓ |
| tsc+vite web | npm run build --workspace web | 通过 | 通过 | ✓ |
| oxlint web | npm run lint --workspace web | 无警告 | 无输出 | ✓ |
| complete() JSON | maxTokens=512, deepseek-v4-flash | 完整 JSON | 85 字符，可 parse，source=llm | ✓ |
| 容器扩展 | grep next/done | 有参数 | 有 | ✓ |
| pi 进程 | docker exec ps | 有 pi | 3 个 pi | ✓ |
| 临时群分工 | Judy→Ashford→蜻蜓队长写 md | 工具卡+文件卡+next 交接+系统行 | 见 findings | ✓ |
| 无 @ 提问 | 「这个文件现在有几节？」 | 至少一人回答 | Judy 答 3 节；source=llm | ✓ |
| 私聊 | Judy「只回复 pong」 | 不受影响 | 回复 pong | ✓ |
| abort main | 群轮中 abort Judy main | 群轮继续 | 三人做完 | ✓ |
| 删临时群 | DELETE /api/groups/bc8dfe6f | 列表无此群 | 无 | ✓ |
| 3 条 send_message | — | next 不丢 | 没构造该场景 | 没验证 |
| 同批双 next | — | 合并去重 | 没构造该场景 | 没验证 |
| handoff userTask | — | 全量 latestUserTask | 没跑转交起轮 | 没验证 |
| 主持人 done@0 | — | 降级挑人 | 主持人这次返回了 next=Judy | 没验证 |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 16:15 | e2e DELETE 空 JSON body → Fastify 400 | 1 | 无 body 再删；群已不在列表 |
| 16:15 | PowerShell 控制台中文乱码 | 1 | 用 node / docker UTF-8 核对 |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | 缺陷已修，真实验证已跑，待第二次提交 |
| Where am I going? | 把本轮修复作为独立于基线的提交 |
| What's the goal? | 交接信号不丢、无人发言时不误收工、主持人可观测，并且真的跑过 |
| What have I learned? | 即时落库必须和编排器扫描范围对齐；bridge 已存在时也要补拉会话 |
| What have I done? | 见上 |
