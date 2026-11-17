# RCS 协议契约审计（2026-11-17）

## 目的

用户对现有 `packages/rcs` 是否还有潜在缺陷没有把握，提出"只参考 `src/bridge/`，重写一个多租户 RCS SaaS"的可能性。本审计先回答两个问题：

1. 现有实现相对 `src/bridge/`（客户端契约的权威来源）到底有哪些真实缺陷？
2. 如果重写，必须守住哪些协议约束？

本文只做研究结论，**不含任何实现改动**。所有"已确认"条目均已对照代码逐条核实，并标注 `file:line`；标注"潜在"的条目表示当前默认部署路径不会触发（通常是只被 CCR v2 路径使用，而 RCS 明确报告 `use_code_sessions: false`）。

## 结论摘要

- 现有实现的核心缺陷**不是零星 bug，而是几条贯穿性的设计缺口**：会话活性没有真实来源、环境回收与环境复用互相打架、去重键没有数据库层唯一性、CCR v2 只实现了半套。
- 其中"会话过一会变成已归档、无法发送新消息"是**确定性复现的设计缺陷**，不是偶发。见 P0-2 与 P0-3。
- 建议：**先修补（P0 共 4 个，均在几十行内可封闭），再决定是否重写**。重写的真正成本不在协议本身，而在重新踩一遍这些边界；协议约束本身不复杂，下面已完整列出。
- 若最终重写：多租户的正确性基础是"所有资源都从认证主体派生归属并做双重校验"，而不是在查询里过滤 unowned。

## 已确认缺陷（按严重度）

### P0-1 跨租户会话注入：`POST /v1/code/sessions` 不校验环境归属

**证据**

- `packages/rcs/src/routes/v2/code-sessions.ts:19-28`：接受任意 `environment_id`，直接 `createCodeSession`，无归属校验。
- 对照 `packages/rcs/src/routes/v1/sessions.ts:45-51` 与 `routes/web/sessions.ts:92-99`：这两处都通过 `resolveDispatchEnvironment` 拒绝"他人环境"。
- `packages/rcs/src/services/session.ts:80-100`：`createCodeSession` 不做任何所有权检查。

**影响**
成员 A 可以创建一个绑定到成员 B 环境的 code session。该 session 以 `idle` 状态落库并归属 A。B 的 bridge 下次重连时，`reconnectWorkForEnvironment`（`services/work-dispatch.ts:144-148`）按 environment 列出所有 idle session 并派发工单——于是 B 的机器会拉起 A 的会话。这是一条真实的跨租户执行路径，不只是数据泄露。

**修复方向**
在 `code-sessions.ts` 复用 `v1/sessions.ts` 的 `resolveDispatchEnvironment` 守卫，未知环境直接 404、他人环境 403。session 的 `ownerUserId` 必须与环境归属一致时才允许绑定。

### P0-2 会话假死：活性只看 `sessions.updated_at`，事件写入不刷新

**证据**

- `services/disconnect-monitor.ts:41-46`：`running`/`idle` 会话只要 `now - session.updatedAt > disconnectTimeout * 2`（默认 `300s * 2`）就置为 `inactive`。
- `transport/event-bus.ts:275-320`：事件持久化只写 `session_events`，不更新 `sessions.updated_at`。
- `routes/v1/session-ingress.ts:31-46` 与 `transport/ws-handler.ts:228-279`（bridge 的常规写入路径）都不 touch session。
- `contracts.ts:100,112-114`：`inactive` 属于 `CLOSED_SESSION_STATUSES`。
- `routes/web/control.ts:31-33`：closed 状态一律 409。

**影响**
任何 `idle` 会话（等待用户输入）只要 10 分钟内没有一次 `sessions.update`，就会被判 inactive，之后前端发送消息一律 409。这正是用户观察到的"过一会就变成已归档、无法发送"。注意：即使 bridge 全程在线、事件持续流动，也不会阻止这次误判，因为事件写入不刷新会话活性。

**修复方向**
活性必须有真实来源。最小改法：事件写入路径顺带 touch session；更正确的改法是"会话是否存活"由"其环境是否 active + 该环境是否持有 work 或连接"派生，不要用写时间戳做 liveness。无论哪种，都要把 `inactive` 从"不可恢复"语义里拿出来（见 P1-5）。

### P0-3 环境误回收后无法复用：回收窗口 300s，桥在满容量时 600s 才轮询一次

**证据**

- `services/disconnect-monitor.ts:29-38`：`last_poll_at` 超过 `disconnectTimeout`（默认 300s）的环境置为 `disconnected`。
- 客户端满容量轮询默认 600s（`src/bridge/pollConfigDefaults.ts:30`，`poll_interval_ms_at_capacity`），且 `non_exclusive_heartbeat_interval_ms` 默认 0（`:63`）。
- `db/repositories/environments.ts:66-79`：`findReusable` 只复用 `status === 'active'` 的环境。
- `services/environment.ts:157-159`：`updatePollTime` 只刷新 `last_poll_at`，**不恢复 status**。

**影响**
健康且连接中的 bridge，只要处于满容量（不主动 seek work），就会在 5 分钟时被标记 disconnected；之后 `/work/poll` 不会把它救回来。更糟的是下一次注册（带同一个 `environment_id`）会因 `findReusable` 拒绝而复用失败，从而**新建一个环境 id**：旧环境上的会话全部成为孤儿，Web 端环境列表也不再出现旧环境。`createWorkItem` 对非 active 环境直接抛错（`services/work-dispatch.ts:81-83`），而路由层吞掉这个错误（`routes/v1/sessions.ts:60-66`、`routes/web/sessions.ts:112-118`），表现为"会话创建成功但永远不会被派发"。

**修复方向**
三选一或组合：把 `disconnectTimeout` 调到大于客户端满容量轮询间隔；让 `/work/poll` 顺带把环境恢复为 active；或把 `findReusable` 允许复用 `disconnected/offline`（这是 worker 侧主动回收状态，不是所有权变更）。同时停止在路由里吞掉 `createWorkItem` 失败。

### P0-4 `message_uuid` 去重是 TOCTOU，去重键在数据库层不唯一

**证据**

- `db/schema.ts:135-138`：`session_events_session_message_uuid_idx` 是普通索引，不是 `UNIQUE`。
- `transport/event-bus.ts:317-320`：`hasMessageUuid()` 查询后再 `append`，两步之间无事务、无 `ON CONFLICT`。
- `db/repositories/events.ts:64-71`：`hasMessageUuid` 是独立 `SELECT`。
- per-session 串行队列只存在于单进程的 WS 路径（`transport/ws-handler.ts:44-47,185-190`）；HTTP 写入路径没有队列：`routes/v1/session-ingress.ts:40-43`、`routes/v2/worker-events.ts:43-47`、`routes/v1/sessions.ts:126-130`。

**影响**
bridge 重连时的批量重放、或并发的 HTTP POST，可以同时通过 `hasMessageUuid` 检查并各自插入，产生重复的 `assistant`/`tool_use` 事件。重复的 `tool_use` 正是模型 API 400（`tool_use ids were found without tool_result`）的直接来源。也就是说，我们已经修好的重放回路，在并发下仍有残留窗口。

**注意**：不能简单加 `UNIQUE(session_id, message_uuid)`，因为 `publishSessionEvent` 有意允许同一 uuid 的出站重写（`transport/event-bus.ts:285-295`）。正确做法是部分唯一索引（仅 `direction = 'inbound' AND message_uuid IS NOT NULL`）或 `INSERT ... ON CONFLICT DO NOTHING`，同时把 HTTP 写入也纳入 per-session 串行化（或依赖数据库唯一性兜底）。

### P1-5 `inactive` 是终态，没有恢复路径

**证据**

- `contracts.ts:100`：`inactive` 与 `archived` 同属 closed。
- `routes/web/sessions.ts:54,189`：列表过滤掉 closed；SSE 流对 closed 直接 409。
- `contracts.ts` 与 `services/session.ts` 中没有任何 unarchive / reactivate 入口。
- `services/work-dispatch.ts:144-148`：重连只重新派发 `idle` 会话。

**影响**
一旦因 P0-2 误判进入 `inactive`，该会话即永久不可用：不能发消息、不能重连、不出现在列表。用户唯一的补救是新建会话。UI 文案还对 inactive 显示"会话已归档"（见审计附录的文案条目），进一步误导。

**修复方向**
新增 `unarchive`/`reactivate`，或至少让重连/发送消息时对 `inactive` 尝试恢复为 `idle`。前端文案区分 `archived` 与 `inactive`。

### P1-6 已派发工单没有租约与回收

**证据**

- `db/repositories/work-items.ts:36-54`：`claimNext` 只做 `pending → dispatched`，没有租约到期时间。
- `services/work-dispatch.ts:131-141`：心跳只 `bump` 更新时间，不延长任何可被回收的租约，也不处理"超时未 ack 则回 pending"。
- 客户端明确会传 `reclaim_older_than_ms`（`src/bridge/bridgeApi.ts:210-215`，`src/bridge/pollConfigDefaults.ts:67-71`），但 RCS 的 `/v1/environments/:id/work/poll`（`routes/v1/environments.work.ts:34-46`）完全忽略该参数。

**影响**
worker 领取工单后崩溃（在 ack 之前），该工单永远停留在 `dispatched`，会话不会被自动重新派发，只能依赖人工 `--session-id` 恢复流程。同样是"会话看起来还活着但再也不响应"的来源之一。

### P1-7 事件表无界增长 + 载荷约 2 倍放大

**证据**

- `transport/event-bus.ts:214-249`：`normalizePayload` 把原始 payload 整份塞进 `raw`，同时再展开一份扁平字段。
- `db/migrations` 与 `db/schema.ts:115-139`：`session_events` 没有任何保留期/清理机制。
- 流式增量（`stream_event`/`partial_assistant`）每个增量都落一行。

**影响**
长会话的存储与回放窗口持续膨胀；`eventReplayLimit` 默认 5000，回放时把 `raw` 双份载荷全量读出，重连成本随会话寿命线性增长，最终触发更长的回放和更大的重连抖动。

**修复方向**
流式增量不落库（或合并为整段消息后再落库），引入按会话/时间的保留策略。

### P1-8 多进程部署下实时投递与清理表失效

**证据**

- `transport/event-bus.ts:60,144`：`buses`/`acpBuses` 是模块级内存 Map。
- `transport/ws-handler.ts:39-47`：`cleanupBySession`、`activeConnections`、`ingestQueues` 都是进程内状态。

**影响**
一旦把 gateway 横向扩成多实例（SaaS 的常规做法），A 进程写入的事件不会投递到 B 进程上的 WebSocket/SSE 订阅者；同一会话的连接分散在不同实例时，清理与串行化也各自为政。

**修复方向**
上线多实例前必须引入跨进程广播（Postgres LISTEN/NOTIFY 或 Redis pub/sub），并把 per-session 串行化下沉到数据库层（唯一约束 + `ON CONFLICT`）。

### P1-9 `session_workers.upsert` 读改写丢更新

**证据**

- `db/repositories/session-workers.ts:32-64`：先 `select` 现有行，再在应用层 merge，然后 `onConflictDoUpdate` 写回。

**影响**
心跳（`lastHeartbeatAt`）与 worker 状态更新并发时，后写者会用自己读到的旧快照覆盖先写者的字段，导致心跳时间回退、状态回退。

**修复方向**
`external_metadata` 用 SQL 层 `||` 合并，其余字段按列 `COALESCE`/显式赋值，避免应用层读改写。

### P1-10 重复派发

**证据**

- 工单表没有"同一 session 只能有一个 pending"的唯一约束（`db/schema.ts:96-113`）。
- `services/work-dispatch.ts:144-148` 每次重连都为所有 idle 会话新建工单。
- 客户端 `src/bridge/replBridge.ts` 疑似存在双重重连路径（同一会话可能触发两次 reconnect）；此项未逐行核实，属推断。

**影响**
同一会话出现多个 pending 工单，worker 可能先后领取两条，造成同一会话被启动两次或重复消费。

**修复方向**
对 `(session_id)` 加 `WHERE state = 'pending'` 的部分唯一索引，或派发前做幂等检查。

### P2 潜在缺陷（当前默认路径不触发）

1. **CCR v2 只实现半套**：
   - 缺少 `POST/GET /worker/internal-events`（客户端见 `src/cli/transports/ccrClient.ts:364,795,805`），会话恢复拿不到 transcript/compaction。
   - `/worker/register` 用 `legacyUserAuth`（`routes/v2/worker.ts:115`），而客户端送的是 work secret 里的 worker JWT（`src/bridge/bridgeMain.ts:817`、`src/bridge/replBridgeTransport.ts:176`），v2 模式下会 401。
   - 无 `worker_epoch` 抢占语义（客户端 `src/bridge/replBridgeTransport.ts:195-214` 依赖 409 停掉陈旧 worker）。
   - 以上都只在 `use_code_sessions: true` 或 `CLAUDE_BRIDGE_USE_CCR_V2=1` 时触发；RCS 的 work secret 固定 `use_code_sessions: false`（`services/work-dispatch.ts:35-53`）。
2. **`POST /v1/sessions` 预载事件不解包**：客户端契约要求 `{ type: 'event', data: SDKMessage }`（`src/bridge/createSession.ts:18-23`），RCS 直接原样存储（`routes/v1/sessions.ts:68-74`）。当前所有调用点都传 `events: []`，故未暴露。
3. **`X-Last-Request-Id` 未实现**：客户端依赖它做连接去重/驱逐（`src/cli/transports/WebSocketTransport.ts:137-142,231-239`），服务端忽略。
4. **SSE 回放先 limit 后过滤**：`transport/sse-writer.ts:42-50` 先取窗口再按方向过滤，worker 流在入站事件密集时可能少回放出站事件。
5. **缺索引**：`sessions.environment_id`、`api_keys.user_id`（`db/schema.ts`）。
6. **错误码区分度**：多数路径用 404 隐藏存在性，但 `web/control.ts` 对"存在但非本人"返回 403，可据此探测会话存在性。
7. **legacy 共享池**：未归属的历史环境/会话对任意成员可见可认领（`routes/web/environments.ts:24-27`、`routes/web/sessions.ts:49-54`）。这是有意的迁移兼容，但对新部署是负担。
8. **`RCS_API_KEYS` 映射到首个 admin**：`auth/middleware.ts:48-54,71-75`，该密钥拥有全租户权限且无法按用户撤销。

### 已验证安全（重写时不要退化）

- 会话 id 兼容映射（`session_* ↔ cse_*`）在所有入口都做了归属复核。
- worker token 绑定单一会话；环境 token 绑定单一环境；API key 哈希存储、可撤销。
- ACP 事件总线按 owner 命名空间隔离（`transport/event-bus.ts:146-153`）。
- `listSince` 为 `id > cursor` 排他；`listBefore`/`latestId` 正确。
- 迁移与 schema 一致；时间戳统一 `timestamptz`。
- 没有宽松 CORS；凭证不走 query string。

## 修复 vs 重写

**建议先修。** P0 的四个问题都能在现有结构内闭合，且每一个都有明确的握手点：

| 问题             | 修复落点                                            | 规模  |
| ---------------- | --------------------------------------------------- | ----- |
| P0-1 跨租户注入  | `routes/v2/code-sessions.ts` 加归属守卫             | 小    |
| P0-2 会话假死    | 事件写入 touch session / liveness 改为派生          | 小-中 |
| P0-3 环境误回收  | 轮询恢复 active 或放宽 `findReusable`               | 小    |
| P0-4 去重 TOCTOU | 迁移加部分唯一索引 + `ON CONFLICT`，HTTP 路径串行化 | 中    |

重写并不能自动规避 P0-2/P0-3，因为它们是**语义问题**（什么算"活着"），不是代码质量问题。只有在需要真正的水平扩展（P1-8）时，重写的收益才明显——而这需要先选定跨进程事件总线方案，那才是重写的第一个关键决策。

如果决定重写，下面这份约束清单就是验收基线。

## 重写必须守住的协议约束（invariants）

客户端契约的权威来源是 `src/bridge/`、`src/cli/transports/`、`src/cli/print.ts`。以下每一条都有对应的客户端实现，破坏任何一条都会导致重复消息、400 或会话挂死。

### 传输层

1. **只回放出站事件**。bridge 重连时，服务端只能重放 `direction = 'outbound'` 且不在 `{interrupt, control_request, control_response, permission_response}` 中的事件。回放入站 assistant 历史会让子进程重复注入 `tool_use`，而对应的 `tool_result` 被跳过，下一次模型请求直接 400。（对应已修复的 `transport/ws-handler.ts:121-133,57`。）
2. **NDJSON 帧**。每条出站消息是单行 JSON + `\n`；控制帧 `{"type":"keep_alive"}` 允许随时插入。
3. **写穿优先**。入站事件必须先持久化再发布；订阅者不得看到未落库事件。
4. **`isReplay: true` 的 ack 不落库**。这是客户端对重放 user 消息的确认，持久化会导致每次重连窗口更大，形成复合循环。
5. **去重按消息 uuid，且仅限整消息类型**（`user/assistant/system/result/result_success`）。流式增量共享 uuid 但不是同一条事件，绝不能去重。去重必须在数据库层具备唯一性（P0-4）。
6. **SSE 游标排他**：`Last-Event-ID = N` 表示"回放 `id > N`"。无游标（0）时回放**最新**窗口，不是从头。
7. **Close code 语义**：`4001` 会话不存在、`4003` 未授权，二者是**永久**失败（客户端不做退避重试）；`1001` 是服务端关机。升级先完成、再用 close code 表达拒绝（客户端据此区分永久失败与网络抖动）。
8. **请求体三种形态都要接受**：裸数组、`{ events: [...] }`、CCR `{ events: [{ payload }] }`。
9. **control_response 必须原样带回 `request_id` 与 `updated_input`**；`interrupt` 不得持久化重放。

### 会话生命周期

10. **work secret 形态**：`{ version: 1, session_ingress_token, api_base_url, sources, auth, use_code_sessions }`，`session_ingress_token` 是绑定单一会话的 worker JWT。
11. **派发幂等**：同一会话同一时刻最多一个有效工单；领取需租约，超时未 ack 需可回收（客户端会传 `reclaim_older_than_ms`）。
12. **重连只重新派发 `idle`**，且不能把已处于 active 状态的会话重复拉起。
13. **失败不得静默**：`createWorkItem` 失败（环境非 active 等）必须让创建方感知，不能"会话建成功但永不派发"。

### 多租户

14. **归属从认证主体派生**。任何创建/绑定资源的入口（尤其是带 `environment_id` 的会话创建）都要校验主体对该环境的归属，不能只依赖查询过滤。
15. **双向校验**：worker token → 会话；环境 token → 环境；会话→环境→归属。任何一条链路都要闭环。
16. **列表/历史/SSE 同一套所有权判定**，避免"列表看不到、直链能访问"或反之。
17. **不要把"未归属资源"作为跨租户共享池**；如必须兼容历史数据，要有一次性认领迁移，而不是长期共享。

### 部署

18. **跨进程事件投递**必须先于水平扩展实现；进程内总线只能作为单实例优化。
19. **per-session 串行化**不能只在单个 WS 连接内生效；HTTP 写入路径同样需要（或由数据库唯一性兜底）。

## 建议执行顺序

1. 先修 P0-1（安全）与 P0-3（可用性）——两者都是小改动、直接消除用户已遇到的问题。
2. 再修 P0-2 + P1-5（活性语义 + 恢复路径），并同步修正前端"会话已归档"的文案。
3. 再做 P0-4（迁移 + 写入收敛），这是唯一需要碰数据库结构的 P0。
4. 之后按 P1 逐项（工单租约 → 事件保留 → 多进程总线）推进；每一项都先写失败测试再改（沿用本仓库的 TDD 流程）。

每一步完成后跑 `bun run typecheck && bun run fmt:check && bun run lint && bun test`。
