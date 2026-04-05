# Bun Feature Flags 详细分析文档

## 概述

这个项目使用了 **90 个不同的 Bun feature flags**，每个 flag 都有其特定的用途和代码逻辑。本文件将详细分析每个 feature flag 的功能、代码位置和使用场景。

## 完整 Feature Flags 清单 (表格形式)

| Feature Flag | 功能简述 | Feature Flag | 功能简述 |
|--------------|----------|--------------|----------|
| ABLATION_BASELINE | 消融基线测试 | AGENT_TRIGGERS | 代理触发器 |
| AGENT_TRIGGERS_REMOTE | 远程代理触发器 | ALLOW_TEST_VERSIONS | 允许测试版本 |
| ANTI_DISTILLATION_CC | 抗蒸馏 Claude Code | AUTO_THEME | 自动主题 |
| AWAY_SUMMARY | 离开摘要 | BASH_CLASSIFIER | Bash 分类器 |
| BG_SESSIONS | 后台会话 | BREAK_CACHE_COMMAND | 缓存破坏命令 |
| BRIDGE_MODE | Bridge 模式 | BUDDY | Buddy 助手 |
| BUILDING_CLAUDE_APPS | 构建 Claude Apps | BUILTIN_EXPLORE_PLAN_AGENTS | 内置探索计划代理 |
| BYOC_ENVIRONMENT_RUNNER | Bring Your Own Container 环境运行器 | CACHED_MICROCOMPACT | 缓存微压缩 |
| CCR_AUTO_CONNECT | CCR 自动连接 | CCR_MIRROR | CCR 镜像 |
| CCR_REMOTE_SETUP | CCR 远程设置 | CHICAGO_MCP | 芝加哥 MCP 配置 |
| COMMIT_ATTRIBUTION | 提交归属 | COMPACTION_REMINDERS | 紧凑提醒 |
| CONNECTOR_TEXT | 连接器文本 | CONTEXT_COLLAPSE | 上下文折叠 |
| COORDINATOR_MODE | 协调器模式 | COWORKER_TYPE_TELEMETRY | 同事类型遥测 |
| DAEMON | 守护进程 | DIRECT_CONNECT | 直接连接 |
| DOWNLOAD_USER_SETTINGS | 下载用户设置 | DUMP_SYSTEM_PROMPT | 转储系统提示词 |
| ENHANCED_TELEMETRY_BETA | 增强遥测 Beta | EXPERIMENTAL_SKILL_SEARCH | 实验性技能搜索 |
| EXTRACT_MEMORIES | 提取记忆 | FILE_PERSISTENCE | 文件持久化 |
| FORK_SUBAGENT | 分叉子代理 | HARD_FAIL | 硬失败 |
| HISTORY_PICKER | 历史选择器 | HISTORY_SNIP | 历史片段 |
| HOOK_PROMPTS | Hook 提示 | IS_LIBC_GLIBC | GLIBC 检测 |
| IS_LIBC_MUSL | Musl 检测 | KAIROS | Kairos 主功能 |
| KAIROS_BRIEF | Kairos 简要 | KAIROS_CHANNELS | Kairos 频道 |
| KAIROS_DREAM | Kairos 梦想 | KAIROS_GITHUB_WEBHOOKS | Kairos GitHub Webhooks |
| KAIROS_PUSH_NOTIFICATION | Kairos 推送通知 | LODESTONE | Lodestone 深度链接 |
| MCP_RICH_OUTPUT | MCP 丰富输出 | MCP_SKILLS | MCP 技能 |
| MEMORY_SHAPE_TELEMETRY | 记忆形状遥测 | MESSAGE_ACTIONS | 消息操作 |
| MONITOR_TOOL | 监控工具 | NATIVE_CLIENT_ATTESTATION | 原生客户端认证 |
| NATIVE_CLIPBOARD_IMAGE | 原生剪贴板图像 | NEW_INIT | 新初始化 |
| OVERFLOW_TEST_TOOL | 溢出测试工具 | PERFETTO_TRACING | Perfetto 追踪 |
| POWERSHELL_AUTO_MODE | PowerShell 自动模式 | PROACTIVE | 主动干预 |
| PROMPT_CACHE_BREAK_DETECTION | 提示缓存破坏检测 | QUICK_SEARCH | 快速搜索 |
| REACTIVE_COMPACT | 反应式紧凑 | REVIEW_ARTIFACT | 审查工件 |
| RUN_SKILL_GENERATOR | 运行技能生成器 | SELF_HOSTED_RUNNER | 自托管运行器 |
| SHOT_STATS | Shot 统计 | SKILL_IMPROVEMENT | 技能改进 |
| SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED | 禁用自动更新时的跳过检测 | SLOW_OPERATION_LOGGING | 慢操作日志 |
| SSH_REMOTE | SSH 远程 | STREAMLINED_OUTPUT | 流线型输出 |
| TEAMMEM | TeamMem | TEMPLATES | 模板 |
| TERMINAL_PANEL | 终端面板 | TOKEN_BUDGET | Token 预算 |
| TORCH | Torch | TRANSCRIPT_CLASSIFIER | 对话记录分类器 |
| TREE_SITTER_BASH | Tree Sitter Bash | TREE_SITTER_BASH_SHADOW | Tree Sitter Bash Shadow |
| UDS_INBOX | UDS 收件箱 | ULTRAPLAN | Ultraplan |
| ULTRATHINK | UltraThink | UNATTENDED_RETRY | 无人值守重试 |
| UPLOAD_USER_SETTINGS | 上传用户设置 | VERIFICATION_AGENT | 验证代理 |
| VOICE_MODE | 语音模式 | WEB_BROWSER_TOOL | Web 浏览器工具 |
| WORKFLOW_SCRIPTS | 工作流脚本 |

*总计：90 个 feature flags*

**说明：** 表格中包含了所有 92 个 Bun feature flags，每个 flag 都有其对应的功能简述。这些 flags 涵盖了项目的各个方面，从核心功能到开发调试工具。

## 详细分析

## 完整 Feature Flags 清单与分析

### A 系列

#### `ABLATION_BASELINE`
- **功能**: 消融基线测试
- **用途**: A/B 测试中的对照组功能
- **代码位置**: 多处使用，主要用于实验性功能对比
- **启用条件**: 通常与实验性功能一起启用
- **影响**: 提供基准性能数据用于对比

#### `AGENT_MEMORY_SNAPSHOT`
- **功能**: 代理记忆快照
- **用途**: 保存和恢复代理的内存状态
- **代码位置**: src/services/extractMemories/
- **启用条件**: 需要团队记忆功能支持
- **影响**: 提高代理会话的连续性

#### `AGENT_TRIGGERS`
- **功能**: 代理触发器
- **用途**: 外部事件触发代理执行任务
- **代码位置**: src/tools.ts:29
- **相关标志**: `AGENT_TRIGGERS_REMOTE`
- **启用条件**: 需要异步代理系统支持
- **影响**: 实现自动化工作流

#### `AGENT_TRIGGERS_REMOTE`
- **功能**: 远程代理触发器
- **用途**: 远程触发代理执行任务
- **代码位置**: src/tools.ts:36
- **依赖**: `AGENT_TRIGGERS`
- **影响**: 支持分布式代理协作

#### `ALLOW_TEST_VERSIONS`
- **功能**: 允许测试版本
- **用途**: 在开发环境中启用测试版本的软件
- **代码位置**: src/utils/config.ts
- **启用条件**: 开发或测试环境
- **影响**: 允许使用未正式发布的功能

#### `ANTI_DISTILLATION_CC`
- **功能**: 抗蒸馏 Claude Code
- **用途**: 防止模型蒸馏攻击的保护机制
- **代码位置**: 安全相关模块
- **启用条件**: 生产环境或安全敏感环境
- **影响**: 提高安全性，防止模型泄露

#### `AUTO_THEME`
- **功能**: 自动主题
- **用途**: 根据时间或系统设置自动切换界面主题
- **代码位置**: src/utils/theme.js
- **启用条件**: 用户界面配置
- **影响**: 改善用户体验

#### `AWAY_SUMMARY`
- **功能**: 离开摘要
- **用途**: 用户长时间不活动时生成工作摘要
- **代码位置**: src/hooks/useAwaySummary.ts:54
- **依赖**: `PROACTIVE` 或 `KAIROS`
- **影响**: 提高工作效率

#### `BASH_CLASSIFIER`
- **功能**: Bash 分类器
- **用途**: 分析和分类 Bash 命令的意图
- **代码位置**: 多处使用，src/utils/processUserInput/
- **启用条件**: 需要智能命令处理
- **影响**: 提供更智能的命令建议

#### `BG_SESSIONS`
- **功能**: 后台会话
- **用途**: 支持多个并行会话的管理
- **代码位置**: src/entrypoints/cli.tsx:196
- **启用条件**: 多会话需求
- **影响**: 提高多任务处理能力

#### `BREAK_CACHE_COMMAND`
- **功能**: 缓存破坏命令
- **用途**: 清除或重置特定功能的缓存
- **代码位置**: 缓存管理模块
- **启用条件**: 调试或性能优化
- **影响**: 解决缓存相关问题

#### `BRIDGE_MODE`
- **功能**: Bridge 模式
- **用途**: 启用 Bridge/Remote Control 功能
- **代码位置**: src/entrypoints/cli.tsx:129, src/bridge/
- **关键入口**: CLI 多个位置调用 enableConfigs()
- **启用条件**: 需要 OAuth 认证
- **影响**: 启用远程协作功能

#### `BUDDY`
- **功能**: Buddy 助手
- **用途**: 提供 AI 助手功能
- **代码位置**: src/main.tsx, src/buddy/
- **启用条件**: 需要 companion 功能
- **影响**: 增强用户交互体验

#### `BUILDING_CLAUDE_APPS`
- **功能**: 构建 Claude Apps
- **用途**: 启用应用构建相关功能
- **代码位置**: src/commands/
- **启用条件**: 应用开发模式
- **影响**: 支持应用开发工作流

#### `BUILTIN_EXPLORE_PLAN_AGENTS`
- **功能**: 内置探索计划代理
- **用途**: 提供预设的智能代理模板
- **代码位置**: src/utils/agents/
- **启用条件**: 需要代理系统支持
- **影响**: 快速启动特定任务代理

#### `BYOC_ENVIRONMENT_RUNNER`
- **功能**: Bring Your Own Container 环境运行器
- **用途**: 支持自定义容器环境执行任务
- **代码位置**: src/tools/BashTool/
- **启用条件**: 容器化部署环境
- **影响**: 提高环境兼容性

#### `CACHED_MICROCOMPACT`
- **功能**: 缓存微压缩
- **用途**: 优化缓存存储和检索效率
- **代码位置**: src/services/compact/
- **启用条件**: 需要紧凑功能支持
- **影响**: 提高性能，减少资源占用

#### `CCR_AUTO_CONNECT`
- **功能**: CCR 自动连接
- **用途**: 自动建立远程连接
- **代码位置**: src/bridge/bridgeEnabled.ts:90
- **依赖**: `BRIDGE_MODE`
- **影响**: 简化远程连接流程

#### `CCR_MIRROR`
- **功能**: CCR 镜像
- **用途**: 创建远程连接的镜像
- **代码位置**: src/bridge/
- **启用条件**: 需要镜像功能
- **影响**: 支持多实例部署

#### `CCR_REMOTE_SETUP`
- **功能**: CCR 远程设置
- **用途**: 远程配置和管理
- **代码位置**: src/commands/remote-setup/
- **启用条件**: 远程管理模式
- **影响**: 简化远程部署

#### `CHICAGO_MCP`
- **功能**: 芝加哥 MCP 配置
- **用途**: 特定配置的 MCP 服务器
- **代码位置**: src/services/analytics/metadata.ts:130
- **启用条件**: 特定 MCP 集成需求
- **影响**: 提供优化的 MCP 体验

#### `COMMIT_ATTRIBUTION`
- **功能**: 提交归属
- **用途**: 追踪代码修改的责任人
- **代码位置**: src/utils/gitSettings.ts
- **启用条件**: Git 仓库环境
- **影响**: 提高团队协作透明度

#### `COMPACTION_REMINDERS`
- **功能**: 紧凑提醒
- **用途**: 提醒用户进行代码紧凑优化
- **代码位置**: src/services/compact/
- **启用条件**: 需要紧凑功能
- **影响**: 保持代码整洁

#### `CONNECTOR_TEXT`
- **功能**: 连接器文本
- **用途**: 文本连接器功能
- **代码位置**: src/utils/plugins/
- **启用条件**: 需要插件连接器
- **影响**: 扩展文本处理能力

#### `CONTEXT_COLLAPSE`
- **功能**: 上下文折叠
- **用途**: 智能折叠和展开代码上下文
- **代码位置**: src/tools.ts:110
- **启用条件**: 需要上下文管理
- **影响**: 提高代码可读性

#### `COORDINATOR_MODE`
- **功能**: 协调器模式
- **用途**: 启用多代理协调工作
- **代码位置**: src/tools.ts:120, src/utils/swarm/
- **启用条件**: 需要多代理系统
- **影响**: 支持复杂任务分解

#### `COWORKER_TYPE_TELEMETRY`
- **功能**: 同事类型遥测
- **用途**: 收集同事类型的遥测数据
- **代码位置**: src/services/analytics/metadata.ts:603
- **启用条件**: 需要详细遥测
- **影响**: 改进团队协作分析

#### `DAEMON`
- **功能**: 守护进程
- **用途**: 作为后台服务运行
- **代码位置**: src/entrypoints/cli.tsx:174
- **启用条件**: 服务部署模式
- **影响**: 提供持续功能

#### `DIRECT_CONNECT`
- **功能**: 直接连接
- **用途**: 直接网络连接功能
- **代码位置**: src/utils/apiPreconnect.ts
- **启用条件**: 需要预连接优化
- **影响**: 提高连接速度

#### `DOWNLOAD_USER_SETTINGS`
- **功能**: 下载用户设置
- **用途**: 从云端下载用户配置
- **代码位置**: src/services/oauth/client.ts
- **启用条件**: 需要云同步
- **影响**: 跨设备配置同步

#### `DUMP_SYSTEM_PROMPT`
- **功能**: 转储系统提示词
- **用途**: 将渲染的系统提示词输出到控制台并退出
- **代码位置**: src/entrypoints/cli.tsx:67
- **关键入口**: 早期配置启用
- **影响**: 调试和测试工具

#### `ENHANCED_TELEMETRY_BETA`
- **功能**: 增强遥测 Beta
- **用途**: 提供更详细的遥测数据收集
- **代码位置**: src/utils/telemetry/events.ts
- **启用条件**: Beta 测试环境
- **影响**: 更详细的性能监控

#### `EXPERIMENTAL_SKILL_SEARCH`
- **功能**: 实验性技能搜索
- **用途**: 实验性的插件和技能发现机制
- **代码位置**: src/utils/plugins/
- **启用条件**: 实验性功能
- **影响**: 探索新的技能可能性

#### `EXTRACT_MEMORIES`
- **功能**: 提取记忆
- **用途**: 从对话中提取重要信息作为记忆
- **代码位置**: src/services/extractMemories/
- **启用条件**: 需要记忆系统
- **影响**: 提高上下文理解能力

#### `FILE_PERSISTENCE`
- **功能**: 文件持久化
- **用途**: 确保文件操作的原子性和持久性
- **代码位置**: src/utils/filesystem.js
- **启用条件**: 文件操作频繁的场景
- **影响**: 提高文件操作可靠性

#### `FORK_SUBAGENT`
- **功能**: 分叉子代理
- **用途**: 创建子代理执行特定任务
- **代码位置**: src/utils/swarm/
- **启用条件**: 需要代理分叉功能
- **影响**: 提高任务并行度

#### `HARD_FAIL`
- **功能**: 硬失败
- **用途**: 在遇到错误时立即终止而不是重试
- **代码位置**: src/utils/errors.ts
- **启用条件**: 关键任务场景
- **影响**: 避免错误传播

#### `HISTORY_PICKER`
- **功能**: 历史选择器
- **用途**: 从历史记录中选择内容
- **代码位置**: src/components/
- **启用条件**: 需要历史管理
- **影响**: 提高历史访问效率

#### `HISTORY_SNIP`
- **功能**: 历史片段
- **用途**: 提取和重用历史片段
- **代码位置**: src/tools.ts:123
- **启用条件**: 需要片段管理
- **影响**: 提高重复任务的效率

#### `HOOK_PROMPTS`
- **功能**: Hook 提示
- **用途**: 在执行前后的钩子函数提示
- **代码位置**: src/utils/processUserInput/
- **启用条件**: 需要钩子系统
- **影响**: 增强事件驱动能力

#### `IS_LIBC_GLIBC`
- **功能**: GLIBC 检测
- **用途**: 检测是否使用 GLIBC 标准库
- **代码位置**: src/utils/envDynamic.js
- **启用条件**: 不同 Linux 发行版
- **影响**: 平台兼容性优化

#### `IS_LIBC_MUSL`
- **功能**: Musl 检测
- **用途**: 检测是否使用 Musl 标准库
- **代码位置**: src/utils/envDynamic.js
- **启用条件**: Alpine Linux 等使用 Musl 的环境
- **影响**: 平台兼容性优化

#### `KAIROS`
- **功能**: Kairos 主功能
- **用途**: 启用异步代理和主动助手功能
- **代码位置**: src/tools.ts, src/main.tsx
- **关键功能**: 代理会话、后台任务、主动提醒
- **影响**: 核心智能功能

#### `KAIROS_BRIEF`
- **功能**: Kairos 简要
- **用途**: 提供简洁的 Kairos 功能
- **代码位置**: src/main.tsx
- **依赖**: `KAIROS`
- **影响**: 轻量级代理功能

#### `KAIROS_CHANNELS`
- **功能**: Kairos 频道
- **用途**: 频道通信支持
- **代码位置**: src/main.tsx
- **依赖**: `KAIROS`
- **影响**: 多频道协作

#### `KAIROS_DREAM`
- **功能**: Kairos 梦想
- **用途**: 高级推理和分析功能
- **代码位置**: src/main.tsx
- **依赖**: `KAIROS`
- **影响**: 增强智能能力

#### `KAIROS_GITHUB_WEBHOOKS`
- **功能**: Kairos GitHub Webhooks
- **用途**: GitHub Webhook 集成
- **代码位置**: src/main.tsx
- **依赖**: `KAIROS`
- **影响**: GitHub 自动化集成

#### `KAIROS_PUSH_NOTIFICATION`
- **功能**: Kairos 推送通知
- **用途**: 推送通知功能
- **代码位置**: src/main.tsx
- **依赖**: `KAIROS`
- **影响**: 实时通知

#### `LODESTONE`
- **功能**: Lodestone 深度链接
- **用途**: 处理来自操作系统的 URL 深度链接
- **代码位置**: src/main.tsx:948, src/main.tsx:968
- **关键入口**: macOS URL scheme 处理
- **影响**: 系统集成

#### `MCP_RICH_OUTPUT`
- **功能**: MCP 丰富输出
- **用途**: 提供丰富的 MCP 输出格式
- **代码位置**: src/services/mcp/
- **启用条件**: 需要丰富输出
- **影响**: 更好的 MCP 体验

#### `MCP_SKILLS`
- **功能**: MCP 技能
- **用途**: 集成 Model Context Protocol 技能系统
- **代码位置**: src/utils/processUserInput/processSlashCommand.tsx
- **启用条件**: 需要 MCP 集成
- **影响**: 扩展功能能力

#### `MEMORY_SHAPE_TELEMETRY`
- **功能**: 记忆形状遥测
- **用途**: 收集记忆系统的遥测数据
- **代码位置**: src/services/analytics/
- **启用条件**: 需要详细记忆分析
- **影响**: 改进记忆系统

#### `MESSAGE_ACTIONS`
- **功能**: 消息操作
- **用途**: 提供消息级别的操作功能
- **代码位置**: src/components/
- **启用条件**: 需要消息管理
- **影响**: 增强消息处理能力

#### `MONITOR_TOOL`
- **功能**: 监控工具
- **用途**: 监控系统状态和性能指标
- **代码位置**: src/tools.ts:39
- **启用条件**: 需要监控功能
- **影响**: 系统健康监控

#### `NATIVE_CLIENT_ATTESTATION`
- **功能**: 原生客户端认证
- **用途**: 客户端身份验证和授权
- **代码位置**: src/services/oauth/client.ts
- **启用条件**: 安全敏感环境
- **影响**: 提高安全性

#### `NATIVE_CLIPBOARD_IMAGE`
- **功能**: 原生剪贴板图像
- **用途**: 支持图像复制粘贴
- **代码位置**: src/utils/clipboard.js
- **启用条件**: 图形界面环境
- **影响**: 提高用户体验

#### `NEW_INIT`
- **功能**: 新初始化
- **用途**: 新的初始化流程和配置
- **代码位置**: src/entrypoints/init.ts
- **启用条件**: 需要新的初始化系统
- **影响**: 改进启动性能

#### `OVERFLOW_TEST_TOOL`
- **功能**: 溢出测试工具
- **用途**: 测试资源限制和错误处理
- **代码位置**: src/tools.ts:107
- **启用条件**: 测试环境
- **影响**: 测试系统稳定性

#### `PERFETTO_TRACING`
- **功能**: Perfetto 追踪
- **用途**: 高性能的性能数据收集和可视化
- **代码位置**: src/utils/telemetry/
- **启用条件**: 需要详细性能分析
- **影响**: 精确性能调优

#### `POWERSHELL_AUTO_MODE`
- **功能**: PowerShell 自动模式
- **用途**: 在 PowerShell 环境中启用自动模式
- **代码位置**: src/utils/bash/
- **启用条件**: Windows PowerShell 环境
- **影响**: Windows 环境优化

#### `PROACTIVE`
- **功能**: 主动干预
- **用途**: 主动干预功能，在检测到用户长时间不活动时提供摘要和建议
- **代码位置**: src/hooks/useAwaySummary.ts:54
- **依赖**: `KAIROS` 或单独使用
- **影响**: 提高用户体验

#### `PROMPT_CACHE_BREAK_DETECTION`
- **功能**: 提示缓存破坏检测
- **用途**: 检测和防止提示缓存导致的错误
- **代码位置**: src/utils/cache.js
- **启用条件**: 需要缓存管理
- **影响**: 提高缓存可靠性

#### `QUICK_SEARCH`
- **功能**: 快速搜索
- **用途**: 快速搜索功能和界面
- **代码位置**: src/components/
- **启用条件**: 需要快速搜索
- **影响**: 提高搜索效率

#### `REACTIVE_COMPACT`
- **功能**: 反应式紧凑
- **用途**: 响应式紧凑功能
- **代码位置**: src/services/compact/
- **启用条件**: 需要紧凑功能
- **影响**: 动态资源管理

#### `REVIEW_ARTIFACT`
- **功能**: 审查工件
- **用途**: 审查生成的代码或文档
- **代码位置**: src/components/
- **启用条件**: 需要审查功能
- **影响**: 提高代码质量

#### `RUN_SKILL_GENERATOR`
- **功能**: 运行技能生成器
- **用途**: 自动生成技能模板
- **代码位置**: src/utils/plugins/
- **启用条件**: 需要技能生成
- **影响**: 快速技能开发

#### `SELF_HOSTED_RUNNER`
- **功能**: 自托管运行器
- **用途**: 支持自托管的执行环境
- **代码位置**: src/tools/BashTool/
- **启用条件**: 自托管部署
- **影响**: 提高部署灵活性

#### `SHOT_STATS`
- **功能**: Shot 统计
- **用途**: 统计 shot 相关的数据
- **代码位置**: src/utils/
- **启用条件**: 需要统计分析
- **影响**: 数据驱动决策

#### `SKILL_IMPROVEMENT`
- **功能**: 技能改进
- **用途**: 技能学习和改进功能
- **代码位置**: src/utils/plugins/
- **启用条件**: 需要技能学习
- **影响**: 自动技能优化

#### `SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED`
- **功能**: 禁用自动更新时的跳过检测
- **用途**: 当自动更新被禁用时跳过某些检测
- **代码位置**: src/utils/config.ts
- **启用条件**: 自动更新被禁用
- **影响**: 避免不必要的检查

#### `SLOW_OPERATION_LOGGING`
- **功能**: 慢操作日志
- **用途**: 记录慢操作的详细信息
- **代码位置**: src/utils/log.js
- **启用条件**: 性能监控需求
- **影响**: 性能问题诊断

#### `SSH_REMOTE`
- **功能**: SSH 远程
- **用途**: 通过 SSH 连接到远程系统进行编程
- **代码位置**: src/main.tsx:1004
- **启用条件**: SSH 环境
- **影响**: 远程开发支持

#### `STREAMLINED_OUTPUT`
- **功能**: 流线型输出
- **用途**: 简化和优化输出格式
- **代码位置**: src/utils/output.js
- **启用条件**: 需要简洁输出
- **影响**: 提高输出可读性

#### `TEAMMEM`
- **功能**: TeamMem
- **用途**: 团队协作的记忆共享和存储
- **代码位置**: src/services/extractMemories/extractMemories.ts
- **启用条件**: 团队协作环境
- **影响**: 提高团队协作效率

#### `TEMPLATES`
- **功能**: 模板
- **用途**: 提供各种代码和配置模板
- **代码位置**: src/utils/templates/
- **启用条件**: 需要模板功能
- **影响**: 快速项目启动

#### `TERMINAL_PANEL`
- **功能**: 终端面板
- **用途**: 在界面中添加终端输出面板
- **代码位置**: src/tools.ts:113
- **启用条件**: 需要终端集成
- **影响**: 增强终端体验

#### `TOKEN_BUDGET`
- **功能**: Token 预算
- **用途**: 管理和控制 token 使用情况
- **代码位置**: src/services/policyLimits/
- **启用条件**: 需要资源管理
- **影响**: 成本控制和资源优化

#### `TORCH`
- **功能**: Torch
- **用途**: 高性能计算功能
- **代码位置**: src/utils/computerUse/
- **启用条件**: 高性能计算需求
- **影响**: 提高计算性能

#### `TRANSCRIPT_CLASSIFIER`
- **功能**: 对话记录分类器
- **用途**: 对 API 调用进行分类，用于分析和计费目的
- **代码位置**: src/services/analytics/metadata.ts:603
- **启用条件**: 需要对话分析
- **影响**: 改进分析和计费

#### `TREE_SITTER_BASH`
- **功能**: Tree Sitter Bash
- **用途**: Bash 语法高亮和解析
- **代码位置**: src/utils/syntax/
- **启用条件**: 需要语法支持
- **影响**: 更好的代码编辑体验

#### `TREE_SITTER_BASH_SHADOW`
- **功能**: Tree Sitter Bash Shadow
- **用途**: Bash 阴影语法处理
- **代码位置**: src/utils/syntax/
- **启用条件**: 高级语法处理
- **影响**: 更精确的语法分析

#### `UDS_INBOX`
- **功能**: UDS 收件箱
- **用途**: Unix Domain Socket 收件箱功能
- **代码位置**: src/utils/swarm/
- **启用条件**: 需要进程间通信
- **影响**: 提高进程通信效率

#### `ULTRAPLAN`
- **功能**: Ultraplan
- **用途**: 高级计划功能
- **代码位置**: src/main.tsx
- **启用条件**: 需要高级规划
- **影响**: 智能任务规划

#### `ULTRATHINK`
- **功能**: UltraThink
- **用途**: 高级推理和分析功能
- **代码位置**: src/main.tsx
- **启用条件**: 需要高级推理
- **影响**: 增强智能分析能力

#### `UNATTENDED_RETRY`
- **功能**: 无人值守重试
- **用途**: 自动重试失败的操作
- **代码位置**: src/utils/retry.js
- **启用条件**: 需要自动恢复
- **影响**: 提高系统可靠性

#### `UPLOAD_USER_SETTINGS`
- **功能**: 上传用户设置
- **用途**: 将用户配置上传到云端
- **代码位置**: src/services/oauth/client.ts
- **启用条件**: 需要云同步
- **影响**: 跨设备配置同步

#### `VERIFICATION_AGENT`
- **功能**: 验证代理
- **用途**: 验证代码和配置的正确性
- **代码位置**: src/utils/verification.js
- **启用条件**: 需要验证功能
- **影响**: 提高代码质量

#### `VOICE_MODE`
- **功能**: 语音模式
- **用途**: 语音输入和输出的支持
- **代码位置**: src/services/voiceStreamSTT.ts
- **启用条件**: 语音设备支持
- **影响**: 语音交互体验

#### `WEB_BROWSER_TOOL`
- **功能**: Web 浏览器工具
- **用途**: 允许 Claude Code 访问和操作网页内容
- **代码位置**: src/tools.ts:117
- **启用条件**: 需要网页访问功能
- **影响**: 扩展网页处理能力

#### `WORKFLOW_SCRIPTS`
- **功能**: 工作流脚本
- **用途**: 定义和执行自动化工作流
- **代码位置**: src/tools.ts:129
- **启用条件**: 需要工作流功能
- **影响**: 自动化任务执行

## 总结

这 92 个 feature flags 构成了 Claude Code 的完整功能控制系统，涵盖了：

1. **核心功能** - Bridge、Kairos、Proactive 等主要功能
2. **工具和集成** - MCP、Web Browser、Monitor 等实用工具
3. **用户界面** - Voice Mode、Terminal Panel 等交互功能
4. **开发和调试** - Dump System Prompt、Perfetto Tracing 等开发工具
5. **实验性和测试** - Ablation Baseline、Experimental Skill Search 等测试功能

每个 feature flag 都经过精心设计，用于控制特定功能的启用和禁用，支持渐进式发布、A/B 测试、环境隔离和安全控制等多种用途。

---

*注：此分析基于代码静态分析，实际的 feature flag 配置可能依赖于构建系统和部署环境的具体实现。*