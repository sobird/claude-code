# 功能变更报告 2.1.94 → 2.1.100

数据来源：`status.json`、两份 `inventory.json` 与官方 release notes；由 `bun scripts/upgrade/cli.ts features` 生成。

## 概览

| 项                | 数量 |
| ----------------- | ---- |
| 新增（inventory） | 4    |
| 官方删除但保留    | 2    |
| 跟随官方删除      | 1    |
| release items     | 104  |
| 未覆盖            | 0    |

## 新增功能点（inventory）

### 命令

- `setup-vertex (local-jsx)`

### 环境变量

- `CLAUDE_CODE_MAX_CONTEXT_TOKENS`
- `CLAUDE_CODE_PERFORCE_MODE`
- `CLAUDE_CODE_SCRIPT_CAPS`

### CLI 参数

_none_

行为级新增见下方「全量 release items」中状态为 `ported` / `approximated` 的条目。

## 删除的功能点

### 官方删除但本仓库有意保留

| 条目                 | 状态              | 说明                                                                                                                                                            |
| -------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cmd:buddy            | retained-internal | 上游 2.1.100 移除了 buddy 命令（target bundle 里不再有 name:"buddy" 的命令注册），本仓库有意保留 src/commands/buddy，故登记 retained-internal，不随上游删除。   |
| env:CLAUDE_CODE_REPL | retained-internal | 上游 2.1.100 移除该变量（REPL 特性下线），本仓库 src/tools/REPLTool/constants.ts 仍有 REPLTool 前提，故保留并登记 retained-internal。若后续跟进去 REPL，再改为… |

### 跟随官方同步删除

- `env:CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT`

## 其他台账条目（无 releaseItems）

| 条目                                     | 状态         | 说明                                                                                                                    |
| ---------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| env:CLAUDE_CODE_HOST_HTTP_PROXY_PORT     | approximated | 由打包依赖 @anthropic-ai/sandbox-runtime 注入沙箱子进程；src/ 不直接读取（依赖噪声，沿用 2.1.94 台账）。                |
| env:CLAUDE_CODE_HOST_SOCKS_PROXY_PORT    | approximated | 同 HOST_HTTP_PROXY_PORT：sandbox-runtime 依赖注入，src/ 不直接读取（依赖噪声，沿用 2.1.94 台账）。                      |
| env:CLAUDE_CODE_RESUME_THRESHOLD_MINUTES | approximated | resume-return 提示阈值，本仓库无此提示（沿用 2.1.94 台账）。                                                            |
| env:CLAUDE_CODE_RESUME_TOKEN_THRESHOLD   | approximated | resume-return 提示阈值，本仓库无此提示（沿用 2.1.94 台账）。                                                            |
| env:CLAUDE_CODE_SM_COMPACT               | approximated | 扫描器 ENV_RE 从 ENABLE\_/DISABLE_CLAUDE_CODE_SM_COMPACT 截取的子串名，真实读取点带前缀（扫描噪声，沿用 2.1.94 台账）。 |

## 全量 release items

| #   | 状态               | 台账条目                                                   | 官方说明                                                                                                                                                         |
| --- | ------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | already-present    | behavior:bedrock-empty-auth                                | Fixed Bedrock requests failing with `403 "Authorization header is missing"` when using `AWS_BEARER_TOKEN_BEDROCK` or `CLAUDE_CODE_SKIP_BEDROCK_AUTH` (regressio… |
| 2   | approximated       | bundle-only:noflicker-terminal-fixes                       | Added focus view toggle (`Ctrl+O`) in `NO_FLICKER` mode showing prompt, one-line tool summary with edit diffstats, and final response                            |
| 3   | ported             | behavior:statusline-refresh-interval                       | Added `refreshInterval` status line setting to re-run the status line command every N seconds                                                                    |
| 4   | ported             | behavior:statusline-git-worktree                           | Added `workspace.git_worktree` to the status line JSON input, set when the current directory is inside a linked git worktree                                     |
| 5   | approximated       | behavior:agents-running-tab                                | Added `● N running` indicator in `/agents` next to agent types with live subagent instances                                                                      |
| 6   | approximated       | behavior:cedar-highlighting                                | Added syntax highlighting for Cedar policy files (`.cedar`, `.cedarpolicy`)                                                                                      |
| 7   | ported             | behavior:protected-path-mode-downgrade                     | Fixed `--dangerously-skip-permissions` being silently downgraded to accept-edits mode after approving a write to a protected path                                |
| 8   | already-present    | behavior:bash-permission-hardening                         | Fixed and hardened Bash tool permissions, tightening checks around env-var prefixes and network redirects, and reducing false prompts on common commands         |
| 9   | ported             | behavior:prototype-rule-names                              | Fixed permission rules with names matching JavaScript prototype properties (e.g. `toString`) causing `settings.json` to be silently ignored                      |
| 10  | ported             | behavior:managed-rules-removed-midsession                  | Fixed managed-settings allow rules remaining active after an admin removed them until process restart                                                            |
| 11  | ported             | behavior:additional-directories-midsession                 | Fixed `permissions.additionalDirectories` changes in settings not applying mid-session                                                                           |
| 12  | ported             | behavior:additional-directories-midsession                 | Fixed removing a directory from `settings.permissions.additionalDirectories` revoking access to the same directory passed via `--add-dir`                        |
| 13  | ported             | behavior:mcp-fetch-abort-bridge-leak                       | Fixed MCP HTTP/SSE connections accumulating ~50 MB/hr of unreleased buffers when servers reconnect                                                               |
| 14  | already-present    | behavior:mcp-oauth-metadata-refresh                        | Fixed MCP OAuth `oauth.authServerMetadataUrl` not being honored on token refresh after restart, fixing ADFS and similar IdPs                                     |
| 15  | already-present    | behavior:retry-after-backoff                               | Fixed 429 retries burning all attempts in ~13 seconds when the server returns a small `Retry-After` — exponential backoff now applies as a minimum               |
| 16  | approximated       | behavior:rate-limit-upsell-visibility                      | Fixed rate-limit upgrade options disappearing after context compaction                                                                                           |
| 17  | approximated       | behavior:resume-picker-fixes                               | Fixed several `/resume` picker issues: `--resume <name>` opening uneditable, Ctrl+A reload wiping search, empty list swallowing navigation, task-status text re… |
| 18  | ported             | behavior:file-edit-diff-on-resume                          | Fixed file-edit diffs disappearing on `--resume` when the edited file was larger than 10KB                                                                       |
| 19  | ported             | behavior:persist-attachments-for-external-users            | Fixed `--resume` cache misses and lost mid-turn input from attachment messages not being saved to the transcript                                                 |
| 20  | ported             | behavior:persist-attachments-for-external-users            | Fixed messages typed while Claude is working not being persisted to the transcript                                                                               |
| 21  | ported             | behavior:stop-hook-long-session-truncation                 | Fixed prompt-type `Stop`/`SubagentStop` hooks failing on long sessions, and hook evaluator API errors displaying "JSON validation failed" instead of the actual… |
| 22  | ported             | behavior:subagent-cwd-isolation                            | Fixed subagents with worktree isolation or `cwd:` override leaking their working directory back to the parent session's Bash tool                                |
| 23  | ported             | behavior:compact-fork-skip-transcript                      | Fixed compaction writing duplicate multi-MB subagent transcript files on prompt-too-long retries                                                                 |
| 24  | ported             | behavior:plugin-update-refresh-marketplace                 | Fixed `claude plugin update` reporting "already at the latest version" for git-based marketplace plugins when the remote had newer commits                       |
| 25  | approximated       | behavior:plugin-frontmatter-name-coercion                  | Fixed slash command picker breaking when a plugin's frontmatter `name` is a YAML boolean keyword                                                                 |
| 26  | approximated       | bundle-only:noflicker-copy-wrapped-urls                    | Fixed copying wrapped URLs in `NO_FLICKER` mode inserting spaces at line breaks                                                                                  |
| 27  | approximated       | bundle-only:noflicker-terminal-fixes                       | Fixed scroll rendering artifacts in `NO_FLICKER` mode when running inside zellij                                                                                 |
| 28  | approximated       | bundle-only:noflicker-mcp-hover-crash                      | Fixed a crash in `NO_FLICKER` mode when hovering over MCP tool results                                                                                           |
| 29  | approximated       | bundle-only:noflicker-terminal-fixes                       | Fixed a `NO_FLICKER` mode memory leak where API retries left stale streaming state                                                                               |
| 30  | approximated       | bundle-only:noflicker-terminal-fixes                       | Fixed slow mouse-wheel scrolling in `NO_FLICKER` mode on Windows Terminal                                                                                        |
| 31  | approximated       | bundle-only:noflicker-terminal-fixes                       | Fixed custom status line not displaying in `NO_FLICKER` mode on terminals shorter than 24 rows                                                                   |
| 32  | approximated       | bundle-only:noflicker-terminal-fixes                       | Fixed Shift+Enter and Alt/Cmd+arrow shortcuts not working in Warp with `NO_FLICKER` mode                                                                         |
| 33  | approximated       | bundle-only:noflicker-terminal-fixes                       | Fixed Korean/Japanese/Unicode text becoming garbled when copied in no-flicker mode on Windows                                                                    |
| 34  | already-present    | behavior:bedrock-empty-auth                                | Fixed Bedrock SigV4 authentication failing when `AWS_BEARER_TOKEN_BEDROCK` or `ANTHROPIC_BEDROCK_BASE_URL` are set to empty strings (as GitHub Actions does for… |
| 35  | already-present    | behavior:bash-permission-hardening                         | Improved Accept Edits mode to auto-approve filesystem commands prefixed with safe env vars or process wrappers (e.g. `LANG=C rm foo`, `timeout 5 mkdir out`)     |
| 36  | approximated       | behavior:sandbox-network-autoapprove                       | Improved auto mode and bypass-permissions mode to auto-approve sandbox network access prompts                                                                    |
| 37  | ignored-dependency | bundle-only:sandbox-allowmachlookup                        | Improved sandbox: `sandbox.network.allowMachLookup` now takes effect on macOS                                                                                    |
| 38  | approximated       | behavior:image-compression-budget                          | Improved image handling: pasted and attached images are now compressed to the same token budget as images read via the Read tool                                 |
| 39  | approximated       | behavior:cjk-completion-trigger                            | Improved slash command and `@`-mention completion to trigger after CJK sentence punctuation, so Japanese/Chinese input no longer requires a space before `/` or… |
| 40  | approximated       | behavior:bridge-session-card                               | Improved Bridge sessions to show the local git repo, branch, and working directory on the claude.ai session card                                                 |
| 41  | approximated       | behavior:footer-indicator-layout                           | Improved footer layout: indicators (Focus, notifications) now stay on the mode-indicator row instead of wrapping below                                           |
| 42  | approximated       | behavior:context-low-footer-notification                   | Improved context-low warning to show as a transient footer notification instead of a persistent row                                                              |
| 43  | approximated       | bundle-only:markdown-blockquote-bar                        | Improved markdown blockquotes to show a continuous left bar across wrapped lines                                                                                 |
| 44  | ported             | behavior:transcript-size-empty-hooks-and-original-file-cap | Improved session transcript size by skipping empty hook entries and capping stored pre-edit file copies                                                          |
| 45  | already-present    | behavior:transcript-final-token-usage                      | Improved transcript accuracy: per-block entries now carry the final token usage instead of the streaming placeholder                                             |
| 46  | already-present    | behavior:otel-traceparent                                  | Improved Bash tool OTEL tracing: subprocesses now inherit a W3C `TRACEPARENT` env var when tracing is enabled                                                    |
| 47  | approximated       | bundle-only:claude-api-skill-managed-agents                | Updated `/claude-api` skill to cover Managed Agents alongside the Claude API                                                                                     |
| 48  | ported             | cmd:setup-vertex                                           | Added interactive Google Vertex AI setup wizard accessible from the login screen when selecting "3rd-party platform", guiding you through GCP authentication, p… |
| 49  | already-present    | env:CLAUDE_CODE_PERFORCE_MODE                              | Added `CLAUDE_CODE_PERFORCE_MODE` env var: when set, Edit/Write/NotebookEdit fail on read-only files with a `p4 edit` hint instead of silently overwriting them  |
| 50  | ported             | behavior:monitor-tool                                      | Added Monitor tool for streaming events from background scripts                                                                                                  |
| 51  | already-present    | env:CLAUDE_CODE_SCRIPT_CAPS                                | Added subprocess sandboxing with PID namespace isolation on Linux when `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` is set, and `CLAUDE_CODE_SCRIPT_CAPS` env var to limi… |
| 52  | already-present    | behavior:print-exclude-dynamic-prompt                      | Added `--exclude-dynamic-system-prompt-sections` flag to print mode for improved cross-user prompt caching                                                       |
| 53  | ported             | behavior:statusline-git-worktree                           | Added `workspace.git_worktree` to the status line JSON input, set whenever the current directory is inside a linked git worktree                                 |
| 54  | already-present    | behavior:otel-traceparent                                  | Added W3C `TRACEPARENT` env var to Bash tool subprocesses when OTEL tracing is enabled, so child-process spans correctly parent to Claude Code's trace tree      |
| 55  | already-present    | behavior:lsp-client-info                                   | LSP: Claude Code now identifies itself to language servers via `clientInfo` in the initialize request                                                            |
| 56  | already-present    | behavior:bash-permission-hardening                         | Fixed a Bash tool permission bypass where a backslash-escaped flag could be auto-allowed as read-only and lead to arbitrary code execution                       |
| 57  | ported             | behavior:compound-ask-safety-bypass                        | Fixed compound Bash commands bypassing forced permission prompts for safety checks and explicit ask rules in auto and bypass-permissions modes                   |
| 58  | already-present    | behavior:bash-permission-hardening                         | Fixed read-only commands with env-var prefixes not prompting unless the var is known-safe (`LANG`, `TZ`, `NO_COLOR`, etc.)                                       |
| 59  | ported             | behavior:network-device-redirect                           | Fixed redirects to `/dev/tcp/...` or `/dev/udp/...` not prompting instead of auto-allowing                                                                       |
| 60  | ported             | behavior:streaming-stall-nonstreaming-fallback             | Fixed stalled streaming responses timing out instead of falling back to non-streaming mode                                                                       |
| 61  | already-present    | behavior:retry-after-backoff                               | Fixed 429 retries burning all attempts in ~13s when the server returns a small `Retry-After` — exponential backoff now applies as a minimum                      |
| 62  | already-present    | behavior:mcp-oauth-metadata-refresh                        | Fixed MCP OAuth `oauth.authServerMetadataUrl` config override not being honored on token refresh after restart, affecting ADFS and similar IdPs                  |
| 63  | approximated       | bundle-only:terminal-keyboard-unicode                      | Fixed capital letters being dropped to lowercase on xterm and VS Code integrated terminal when the kitty keyboard protocol is active                             |
| 64  | approximated       | bundle-only:terminal-keyboard-unicode                      | Fixed macOS text replacements deleting the trigger word instead of inserting the substitution                                                                    |
| 65  | ported             | behavior:protected-path-mode-downgrade                     | Fixed `--dangerously-skip-permissions` being silently downgraded to accept-edits mode after approving a write to a protected path via Bash                       |
| 66  | ported             | behavior:managed-rules-removed-midsession                  | Fixed managed-settings allow rules remaining active after an admin removed them, until process restart                                                           |
| 67  | ported             | behavior:additional-directories-midsession                 | Fixed `permissions.additionalDirectories` changes not applying mid-session — removed directories lose access immediately and added ones work without restart     |
| 68  | ported             | behavior:additional-directories-midsession                 | Fixed removing a directory from `additionalDirectories` revoking access to the same directory passed via `--add-dir`                                             |
| 69  | ported             | behavior:bash-rule-whitespace                              | Fixed `Bash(cmd:*)` and `Bash(git commit *)` wildcard permission rules failing to match commands with extra spaces or tabs                                       |
| 70  | already-present    | behavior:bash-permission-hardening                         | Fixed `Bash(...)` deny rules being downgraded to a prompt for piped commands that mix `cd` with other segments                                                   |
| 71  | ported             | behavior:bash-readonly-flag-values                         | Fixed false Bash permission prompts for `cut -d /`, `paste -d /`, `column -s /`, `awk '{print $1}' file`, and filenames containing `%`                           |
| 72  | ported             | behavior:prototype-rule-names                              | Fixed permission rules with names matching JavaScript prototype properties (e.g. `toString`) causing `settings.json` to be silently ignored                      |
| 73  | approximated       | behavior:team-permission-inherit                           | Fixed agent team members not inheriting the leader's permission mode when using `--dangerously-skip-permissions`                                                 |
| 74  | approximated       | bundle-only:noflicker-mcp-hover-crash                      | Fixed a crash in fullscreen mode when hovering over MCP tool results                                                                                             |
| 75  | approximated       | bundle-only:noflicker-copy-wrapped-urls                    | Fixed copying wrapped URLs in fullscreen mode inserting spaces at line breaks                                                                                    |
| 76  | ported             | behavior:file-edit-diff-on-resume                          | Fixed file-edit diffs disappearing from the UI on `--resume` when the edited file was larger than 10KB                                                           |
| 77  | approximated       | behavior:resume-picker-fixes                               | Fixed several `/resume` picker issues: `--resume <name>` opening uneditable, filter reload wiping search state, empty list swallowing arrow keys, cross-project… |
| 78  | already-present    | behavior:export-command                                    | Fixed `/export` not honoring absolute paths and `~`, and silently rewriting user-supplied extensions to `.txt`                                                   |
| 79  | ported             | behavior:effort-max-unknown-models                         | Fixed `/effort max` being denied for unknown or future model IDs                                                                                                 |
| 80  | approximated       | behavior:plugin-frontmatter-name-coercion                  | Fixed slash command picker breaking when a plugin's frontmatter `name` is a YAML boolean keyword                                                                 |
| 81  | approximated       | behavior:rate-limit-upsell-visibility                      | Fixed rate-limit upsell text being hidden after message remounts                                                                                                 |
| 82  | already-present    | behavior:mcp-max-result-size                               | Fixed MCP tools with `_meta["anthropic/maxResultSizeChars"]` not bypassing the token-based persist layer                                                         |
| 83  | approximated       | bundle-only:voice-mode-input                               | Fixed voice mode leaking dozens of space characters into the input when re-holding the push-to-talk key while the previous transcript is still processing        |
| 84  | already-present    | behavior:disable-autoupdater                               | Fixed `DISABLE_AUTOUPDATER` not fully suppressing the npm registry version check and symlink modification on npm-based installs                                  |
| 85  | ported             | behavior:remote-permission-handler-leak                    | Fixed a memory leak where Remote Control permission handler entries were retained for the lifetime of the session                                                |
| 86  | ported             | behavior:background-agent-partial-progress-on-failure      | Fixed background subagents that fail with an error not reporting partial progress to the parent agent                                                            |
| 87  | ported             | behavior:stop-hook-long-session-truncation                 | Fixed prompt-type Stop/SubagentStop hooks failing on long sessions, and hook evaluator API errors showing "JSON validation failed" instead of the real message   |
| 88  | approximated       | bundle-only:feedback-survey                                | Fixed feedback survey rendering when dismissed                                                                                                                   |
| 89  | ported             | behavior:grep-pattern-file                                 | Fixed Bash `grep -f FILE` / `rg -f FILE` not prompting when reading a pattern file outside the working directory                                                 |
| 90  | ported             | behavior:stale-worktree-untracked                          | Fixed stale subagent worktree cleanup removing worktrees that contain untracked files                                                                            |
| 91  | ignored-dependency | bundle-only:sandbox-allowmachlookup                        | Fixed `sandbox.network.allowMachLookup` not taking effect on macOS                                                                                               |
| 92  | approximated       | behavior:resume-filter-hints                               | Improved `/resume` filter hint labels and added project/worktree/branch names in the filter indicator                                                            |
| 93  | approximated       | behavior:footer-indicator-layout                           | Improved footer indicators (Focus, notifications) to stay on the mode-indicator row instead of wrapping at narrow terminal widths                                |
| 94  | approximated       | behavior:agents-running-tab                                | Improved `/agents` with a tabbed layout: a Running tab shows live subagents, and the Library tab adds Run agent and View running instance actions                |
| 95  | already-present    | behavior:reload-plugins-skills                             | Improved `/reload-plugins` to pick up plugin-provided skills without requiring a restart                                                                         |
| 96  | already-present    | behavior:bash-permission-hardening                         | Improved Accept Edits mode to auto-approve filesystem commands prefixed with safe env vars or process wrappers                                                   |
| 97  | approximated       | behavior:vim-normal-history                                | Improved Vim mode: `j`/`k` in NORMAL mode now navigate history and select the footer pill at the input boundary                                                  |
| 98  | ported             | behavior:hook-error-stderr-first-line                      | Improved hook errors in the transcript to include the first line of stderr for self-diagnosis without `--debug`                                                  |
| 99  | ported             | behavior:otel-interaction-span-per-turn                    | Improved OTEL tracing: interaction spans now correctly wrap full turns under concurrent SDK calls, and headless turns end spans per-turn                         |
| 100 | already-present    | behavior:transcript-final-token-usage                      | Improved transcript entries to carry final token usage instead of streaming placeholders                                                                         |
| 101 | approximated       | bundle-only:claude-api-skill-managed-agents                | Updated the `/claude-api` skill to cover Managed Agents alongside Claude API                                                                                     |
| 102 | approximated       | bundle-only:vscode-git-bash                                | [VSCode] Fixed false-positive "requires git-bash" error on Windows when `CLAUDE_CODE_GIT_BASH_PATH` is set or Git is installed at a default location             |
| 103 | already-present    | env:CLAUDE_CODE_MAX_CONTEXT_TOKENS                         | Fixed `CLAUDE_CODE_MAX_CONTEXT_TOKENS` to honor `DISABLE_COMPACT` when it is set.                                                                                |
| 104 | already-present    | behavior:effective-compact-gating                          | Dropped `/compact` hints when `DISABLE_COMPACT` is set.                                                                                                          |

---

完整官方文本与台账 notes 见 `features.json`。inventory 的前缀扫描可能漏收非 `CLAUDE_CODE_*` 变量（如 `CLAUDE_REPL_MODE`），需人工登记后再生成。
