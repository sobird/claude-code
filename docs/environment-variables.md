# OpenClaude 环境变量参考文档

## 概述

本文档列出了 OpenClaude 项目中使用的所有环境变量，包括配置说明和使用场景。

## 核心认证变量

### Anthropic API (默认)

```bash
# 必需 - Anthropic API 密钥
ANTHROPIC_API_KEY=sk-ant-your-key-here

# 可选 - 指定使用的模型版本
# ANTHROPIC_MODEL=claude-sonnet-4-5

# 可选 - 自定义 Anthropic 兼容端点
# ANTHROPIC_BASE_URL=https://api.anthropic.com
```

### AWS Bedrock

```bash
# 启用 Bedrock 支持
CLAUDE_CODE_USE_BEDROCK=1

# AWS 区域配置
AWS_REGION=us-east-1
AWS_DEFAULT_REGION=us-east-1

# Bedrock 认证
AWS_BEARER_TOKEN_BEDROCK=your-bearer-token-here

# Bedrock 基础 URL
ANTHROPIC_BEDROCK_BASE_URL=https://bedrock-runtime.us-east-1.amazonaws.com
```

### Google Vertex AI

```bash
# 启用 Vertex AI 支持
CLAUDE_CODE_USE_VERTEX=1

# GCP 项目配置
ANTHROPIC_VERTEX_PROJECT_ID=your-gcp-project-id
CLOUD_ML_REGION=us-east5
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
```

## 系统级配置

### 用户类型标识

```bash
# 用户类型标识（内部使用）
# 'ant' 表示特殊用户类型，启用额外功能
USER_TYPE=ant

# 演示模式标识
IS_DEMO=true/false

# 演示版本标识
DEMO_VERSION=true/false
```

### Node.js 环境

```bash
# Node.js 环境设置
NODE_ENV=development/production/test
```

## 功能开关和实验性功能

### Claude Code 特定功能

```bash
# 禁用后台任务
CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1

# 启用 eager flush 模式（查询引擎优化）
CLAUDE_CODE_EAGER_FLUSH=1

# 协作者模式
CLAUDE_CODE_IS_COWORK=1

# 禁用命令注入检查
CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK=1

# 启用简单模式（简化界面和功能）
CLAUDE_CODE_SIMPLE=1

# 启用简要工具上传
CLAUDE_CODE_BRIEF_UPLOAD=1

# 启用简要工具
CLAUDE_CODE_BRIEF=1

# 显示 bash sandbox 指示器
CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR=1

# 强制显示完整 Logo
CLAUDE_CODE_FORCE_FULL_LOGO=1
```

### 远程和 CI/CD 相关

```bash
# 启用远程模式
CLAUDE_CODE_REMOTE=1

# 设置远程环境类型
CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE=...

# 协作者类型
CLAUDE_CODE_COWORKER_TYPE=...

# 容器 ID
CLAUDE_CODE_CONTAINER_ID=...

# 远程会话 ID
CLAUDE_CODE_REMOTE_SESSION_ID=...

# Claude Code 标签
CLAUDE_CODE_TAGS=tag1,tag2

# 入口点类型
CLAUDE_CODE_ENTRYPOINT=local-agent

# CI 环境标识
CI=true/false

# GitHub Actions
GITHUB_ACTIONS=true/false

# 事件名称
GITHUB_EVENT_NAME=...

# Runner 环境
RUNNER_ENVIRONMENT=...
RUNNER_OS=...

# Claude Code Action
CLAUDE_CODE_ACTION=true/false
```

### SWE-Bench 测试框架

```bash
# SWE-Bench 运行标识
SWE_BENCH_RUN_ID=...

# SWE-Bench 实例标识
SWE_BENCH_INSTANCE_ID=...

# SWE-Bench 任务标识
SWE_BENCH_TASK_ID=...
```

## 性能和限制配置

### API 重试和超时

```bash
# 最大 API 重试次数（默认：10）
CLAUDE_CODE_MAX_RETRIES=10

# 启用无监督重试模式
CLAUDE_CODE_UNATTENDED_RETRY=1

# API 请求超时（毫秒）
API_TIMEOUT_MS=60000

# 最大结构化输出重试次数
MAX_STRUCTURED_OUTPUT_RETRIES=5

# 文件读取最大输出 token 数
CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=...

# 最大工具使用并发数
CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=10
```

### Token 限制

```bash
# API 最大输入 token 数
API_MAX_INPUT_TOKENS=...

# API 目标输入 token 数
API_TARGET_INPUT_TOKENS=...
```

## 调试和日志

### 调试选项

```bash
# 启用调试日志
CLAUDE_DEBUG=1

# 启用扩展键报告（Kitty 键盘协议）
OPENCLAUDE_ENABLE_EXTENDED_KEYS=1

# 禁用 git commit 中的 Co-authored-by 行
OPENCLAUDE_DISABLE_CO_AUTHORED_BY=1

# 启用 OTEL 工具详情日志
OTEL_LOG_TOOL_DETAILS=1
```

## 内存和存储配置

### 内存路径覆盖

```bash
# 协作者内存路径覆盖
CLAUDE_COWORK_MEMORY_PATH_OVERRIDE=...

# 远程内存目录覆盖
CLAUDE_CODE_REMOTE_MEMORY_DIR=...

# 禁用自动内存管理
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
```

## 语音和音频处理

```bash
# 语音流基础 URL
VOICE_STREAM_BASE_URL=...

# 音频捕获 Node.js 路径
AUDIO_CAPTURE_NODE_PATH=...

# 修饰符 Node.js 路径
MODIFIERS_NODE_PATH=...
```

## 团队协作功能

### OAuth 和账户信息

```bash
# OAuth 刷新令牌
CLAUDE_CODE_OAUTH_REFRESH_TOKEN=...

# OAuth 作用域
CLAUDE_CODE_OAUTH_SCOPES=...

# 账户 UUID
CLAUDE_CODE_ACCOUNT_UUID=...

# 用户邮箱
CLAUDE_CODE_USER_EMAIL=...

# 组织 UUID
CLAUDE_CODE_ORGANIZATION_UUID=...

# 团队记忆同步 URL
TEAM_MEMORY_SYNC_URL=...
```

## 终端和用户界面

### tmux 会话配置

```bash
# tmux 会话名称
CLAUDE_CODE_TMUX_SESSION=...

# tmux 前缀键
CLAUDE_CODE_TMUX_PREFIX=...

# tmux 前缀冲突处理
CLAUDE_CODE_TMUX_PREFIX_CONFLICTS=true/false
```

### 界面定制

```bash
# 语法高亮设置
CLAUDE_CODE_SYNTAX_HIGHLIGHT=...

# BAT 主题
BAT_THEME=...

# 退出后渲染第一个内容
CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER=1

# 启用主动建议
CLAUDE_CODE_PROACTIVE=1

# 启用同步插件安装
CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1

# 同步插件安装超时（毫秒）
CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS=...

# 启用同步输出
CLAUDE_CODE_STREAMLINED_OUTPUT=1

# 启用提示建议
CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=1

# 恢复中断的对话
CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1
```

## 数据分析和遥测

### 分析配置

```bash
# 增长图书基础 URL
CLAUDE_CODE_GB_BASE_URL=...

# 禁用遥测
CLAUDE_CODE_DISABLE_TELEMETRY=1

# Datadog 刷新间隔（毫秒）
CLAUDE_CODE_DATADOG_FLUSH_INTERVAL_MS=...

# 启用会话持久化
ENABLE_SESSION_PERSISTENCE=1
```

## 特殊环境和开发

### 开发环境配置

```bash
# 工作区纪元
CLAUDE_CODE_WORKER_EPOCH=...

# 环境运行器版本
CLAUDE_CODE_ENVIRONMENT_RUNNER_VERSION=...

# 环境种类
CLAUDE_CODE_ENVIRONMENT_KIND=bridge

# CCR V2 支持
CLAUDE_CODE_USE_CCR_V2=1

# CCR V2 会话入口点 V2
CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2=1

# Claude Code SDK 版本
CLAUDE_AGENT_SDK_VERSION=...
```

## 注意事项

1. **安全性**：永远不要在代码仓库中提交包含真实值的 `.env` 文件，确保 `.env` 在 `.gitignore` 中
2. **优先级**：系统环境变量优先级高于项目 `.env` 文件
3. **重启要求**：某些变量更改需要重启应用才能生效
4. **平台兼容性**：所有变量都支持跨平台使用
5. **CI/CD 环境**：在生产环境中，推荐使用环境变量而不是 `.env` 文件

## 示例配置

### 本地开发配置

```bash
# .env 文件示例
ANTHROPIC_API_KEY=sk-ant-your-actual-key
NODE_ENV=development
CLAUDE_DEBUG=1
```

### CI/CD 配置

```bash
# GitHub Actions 环境变量
ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }}
NODE_ENV=production
CI=true
GITHUB_ACTIONS=true
```

### Bedrock 生产配置

```bash
ANTHROPIC_API_KEY=sk-ant-your-key
CLAUDE_CODE_USE_BEDROCK=1
AWS_REGION=us-west-2
AWS_BEARER_TOKEN_BEDROCK=${{ secrets.AWS_BEARER_TOKEN }}
NODE_ENV=production
```
