# OpenClaude 遥测数据配置指南

## 概述

OpenClaude 使用 OpenTelemetry 框架进行遥测数据收集。该系统包含两个主要组件：
- **Datadog** - 第三方监控和分析平台
- **第一方事件日志 (1P Event Logging)** - 专有的内部事件收集系统

## 禁用遥测的方法

### 方法一：通过隐私级别设置（推荐）

```bash
# 完全禁用所有遥测和辅助网络流量
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# 或禁用遥测但保留基本功能
DISABLE_TELEMETRY=1
```

**隐私级别说明：**
- `default` - 所有功能启用（默认）
- `no-telemetry` - 禁用遥测，但允许基本网络功能
- `essential-traffic` - 禁用所有非必要网络流量

### 方法二：环境变量控制

```bash
# 测试环境自动禁用
NODE_ENV=test

# 第三方云服务自动禁用
CLAUDE_CODE_USE_BEDROCK=1      # AWS Bedrock
CLAUDE_CODE_USE_VERTEX=1       # Google Vertex AI
CLAUDE_CODE_USE_FOUNDRY=1      # AWS Foundry

# 直接禁用特定功能
CLAUDE_CODE_DISABLE_TELEMETRY=1
```

## 自定义遥测服务器配置

要将遥测数据发送到您自己的服务器，需要修改 OpenClaude 的配置。由于这是开源项目，您可以：

### 方案一：创建自定义导出器（推荐）

1. **创建自定义导出器**：
```typescript
// src/services/analytics/customEventExporter.ts
import type { LogRecordExporter } from '@opentelemetry/sdk-logs'

export class CustomEventExporter implements LogRecordExporter {
  async export(logRecords: ReadableLogRecord[]): Promise<ExportResult> {
    try {
      // 将日志记录发送到您的服务器
      const events = logRecords.map(record => ({
        timestamp: record.timestamp,
        severity: record.severityText,
        body: record.body?.toString(),
        attributes: record.attributes
      }))

      await fetch('https://your-server.com/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events })
      })

      return { code: ExportResultCode.SUCCESS }
    } catch (error) {
      return { code: ExportResultCode.FAILED, error }
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}
```

2. **在应用启动时注册自定义导出器**：
```typescript
import { initSinks } from '../utils/sinks';
import { CustomEventExporter } from './customEventExporter';

// 在 main.tsx 或 setup.ts 中
const customExporter = new CustomEventExporter();
initSinks(customExporter); // 覆盖默认的遥测配置
```

### 方案二：修改现有导出器配置

编辑 `src/services/analytics/firstPartyEventLoggingExporter.ts` 中的构造函数调用：

```typescript
// 找到初始化代码并修改 endpoint 配置
new FirstPartyEventLoggingExporter({
  baseUrl: 'https://your-custom-endpoint.com',
  path: '/api/telemetry/batch',
  timeout: 30000, // 30秒超时
  maxBatchSize: 100 // 每批100个事件
});
```

### 方案三：使用环境变量重定向

某些情况下，可以通过 API 基础 URL 重定向：

```bash
# 如果您有自己的 Anthropic 兼容端点
ANTHROPIC_BASE_URL=https://your-proxy-server.com

# 或用于 staging 环境的代理
ANTHROPIC_BASE_URL=https://api-staging.anthropic.com
```

## 遥测数据结构

### Datadog 事件格式
```json
{
  "event_name": "string",
  "metadata": {
    "user_id": "string",
    "session_id": "string",
    "feature_used": "string",
    "duration_ms": 1234,
    "success": true,
    "_PROTO_user_email": "encrypted_email" // PII数据
  }
}
```

### 第一方事件格式
```json
{
  "events": [{
    "event_type": "ClaudeCodeInternalEvent",
    "event_data": {
      "@type": "type.googleapis.com/claude_code.v1.Event",
      "timestamp": "2024-01-01T00:00:00Z",
      "event_name": "tool_executed",
      "properties": {
        "tool_name": "bash",
        "execution_time_ms": 1500,
        "success": true
      }
    }
  }]
}
```

## 开发调试遥测

### 查看遥送数据
```bash
# 启用调试日志
CLAUDE_DEBUG=1

# 查看遥测元数据
OTEL_LOG_TOOL_DETAILS=1
```

### 本地存储失败事件
当发送到远程服务器失败时，事件会本地存储在：
```bash
~/.config/claude-code/telemetry/1p_failed_events.{session}.{uuid}.json
```

## 安全考虑

### 数据脱敏
- `_PROTO_*` 字段包含 PII 数据，仅发送给第一方系统
- Datadog 接收时会自动剥离这些字段
- 通用访问后端永远不会看到未加密的 PII 数据

### 隐私保护
- 会话 ID 是临时的，不包含用户身份信息
- 代码片段和文件路径不会被记录
- 用户可以通过隐私级别严格控制数据收集

## 性能影响

### 资源使用
- 遥测对主应用程序性能影响极小
- 事件异步处理，不会阻塞用户操作
- 批量发送减少网络请求数量

### 网络开销
- 默认批处理大小：200 个事件
- 导出间隔：5 秒
- 失败事件重试采用指数退避策略

## 故障排除

### 常见问题

1. **遥测未发送**：
   ```bash
   # 检查隐私级别
   echo $CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
   echo $DISABLE_TELEMETRY

   # 检查网络连接
   curl -v https://api.anthropic.com/health
   ```

2. **事件丢失**：
   - 检查 `~/.config/claude-code/telemetry/` 目录中的失败事件文件
   - 验证服务器端点是否可访问
   - 检查防火墙和网络策略

3. **性能问题**：
   - 减少批处理大小：`maxBatchSize=50`
   - 增加超时时间：`timeout=60000`
   - 禁用 Datadog：`CLAUDE_CODE_DISABLE_DATADOG=1`

### 日志位置
- 应用程序日志：`~/.config/claude-code/logs/`
- 遥测调试输出：控制台（当 `CLAUDE_DEBUG=1` 时）
- 失败事件存储：`~/.config/claude-code/telemetry/`

## 参考链接

- [OpenTelemetry 官方文档](https://opentelemetry.io/)
- [OpenClaude 环境变量文档](environment-variables.md)
- [隐私政策](https://code.claude.com/docs/en/data-usage)
