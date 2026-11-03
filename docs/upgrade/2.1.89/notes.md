# 2.1.89 近似实现与未解点

（条目随各 Task 完成补充。）

## 近似实现

### /autocompact

- 依据 `package/cli.js` 静态抽取：参数解析 `HfK` @9495310、窗口解析 `j56` @9495559、状态文案 `s2Y` @9931819、set/reset `b78` @9932347、注册 `type:"local-jsx",name:"autocompact"` @9937634、设置 schema `.number().int().min(1e5).max(1e6)` @1053664、`CLAUDE_CODE_AUTO_COMPACT_WINDOW` @9495609。范围常量 `D17=1e5`、`jfK=1e6`。
- 数值格式化使用仓库现有 `formatTokens`（Intl compact，`120000` → `120k`），等价于 bundle 的 `A3`/`uK` 近似；两者对 100k–1M 区间输出一致。
- 交互 UI（`autocompact.tsx`）为近似实现：无参数时用 `Dialog` 显示与 `s2Y` 相同的文案，Esc 关闭；带参数时直接走 set/reset 并 `onDone`。上游的上下键滑块（步进 100k）与 `tengu_autocompact_dialog_opened` 事件未移植。
- 分析事件 `tengu_autocompact_command` 未发送：仓库 `LogEventMetadata` 只允许 boolean/number/undefined，而该事件含字符串 `action`，按“非平凡则省略”处理。
- R16：测试按 2.1.89 语义使用 `'50000' → invalid`（范围下限 100k），并导出 `parseAutocompactArgs`；`'2m'` 同样越界为 invalid。
- R17：`scripts/upgrade/scenarios/cmd-autocompact.json` 为 `--version` 探针场景，probe 产出空 trace（`/tmp/autocompact.json`）；以上静态偏移为验收证据。

## 未解点
