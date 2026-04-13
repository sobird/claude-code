# VOICE_MODE 功能文档

## 概述

VOICE_MODE 是 Claude Code 的语音模式功能，允许用户通过麦克风进行语音输入。这是一个功能标志（feature flag），仅在特定构建版本中可用。

## 核心组件

### 1. 语音识别服务 (STT) - `src/services/voiceStreamSTT.ts`

使用 WebSocket 连接到 Anthropic 的 `voice_stream` 端点，支持推送式语音输入（按住说话）。

#### 主要特性：
- 使用 Deepgram Nova 3 模型进行语音转文本
- WebSocket 协议：JSON 控制消息 + 二进制音频帧
- 支持实时语音转文本和自动端点检测
- 关键词术语增强功能
- 多语言支持

#### 技术规格：
- **编码器**: linear16
- **采样率**: 16000Hz
- **通道数**: 1（单声道）
- **端点检测**: 300ms 延迟，1000ms 语句结束超时

### 2. 语音录制服务 - `src/services/voice.ts`

原生音频捕获模块，支持跨平台麦克风访问。

#### 实现细节：
- **原生模块**: audio-capture-napi（macOS/Windows/Linux）
- **Linux 回退**: SoX `rec` 命令或 arecord (ALSA)
- **音频规格**: 16kHz 采样率，单声道

### 3. 语音模式启用检查 - `src/voice/voiceModeEnabled.ts`

验证语音模式是否可以启用。

#### 检查条件：
1. GrowthBook 功能标志 `VOICE_MODE` 必须启用
2. 用户必须有有效的 Anthropic OAuth token
3. 紧急关闭开关 `tengu_amber_quartz_disabled` 不能激活

## STT 服务地址

- WebSocket URL: wss://api.anthropic.com/api/ws/speech_to_text/voice_stream
- 协议: JSON 控制消息 + 二进制音频帧
- 认证: Bearer token (OAuth)
- 规格: linear16, 16kHz, 单声道

### WebSocket 连接 URL

```typescript
const url = `${wsBaseUrl}${VOICE_STREAM_PATH}?${params.toString()}`
```

#### URL 组成部分：
- **基础 URL**: `process.env.VOICE_STREAM_BASE_URL || getOauthConfig().BASE_API_URL.replace('https://', 'wss://')`
- **路径**: `/api/ws/speech_to_text/voice_stream`
- **默认主机**: `api.anthropic.com`（绕过 Cloudflare 防护）
- **查询参数**:
  - `encoding`: linear16
  - `sample_rate`: 16000
  - `channels`: 1
  - `endpointing_ms`: 300
  - `utterance_end_ms`: 1000
  - `language`: 英语（可配置）
  - `keyterms`: 关键词列表（可选）

### 认证要求

- **OAuth Token**: Bearer token 认证
- **用户代理**: `x-app: cli`
- **加密**: mTLS 支持

## 协议规范

### 客户端消息
- **KeepAlive**: `'{"type":"KeepAlive"}'`
- **CloseStream**: `'{"type":"CloseStream"}'`
- **音频数据**: 二进制 WebSocket 帧

### 服务端响应
- **TranscriptText**: `{type: "TranscriptText", data: string}`
- **TranscriptEndpoint**: `{type: "TranscriptEndpoint"}`
- **TranscriptError**: `{type: "TranscriptError", error_code?: string, description?: string}`
- **error**: `{type: "error", message?: string}`

## 安全特性

### 认证机制
- 需要有效的 Anthropic OAuth 认证
- 不支持 API keys、Bedrock 或 Vertex 认证方式
- 自动令牌刷新

### 网络安全
- mTLS 加密连接
- 支持代理配置
- 自动 Cloudflare 防护绕过

### 隐私保护
- 音频数据通过私有 API 传输
- 本地音频处理优先于网络传输

## 配置选项

### 环境变量
- `VOICE_STREAM_BASE_URL`: 自定义 WebSocket 基础 URL
- `BAT_THEME`: 语法主题支持（当前为 stub 实现）

### 运行时配置
- 语言设置（默认为英语）
- 关键词术语列表
- 音频编码参数

## 错误处理

### 常见错误码
- **WebSocket 升级拒绝**: HTTP 4xx/5xx 状态码
- **认证失败**: 无效或过期的 OAuth token
- **网络错误**: 连接超时或中断

### 重试机制
- 自动令牌刷新
- 连接重试逻辑
- 错误分类处理（可恢复 vs 致命错误）

## 性能优化

### 音频处理
- 缓冲区复制避免内存问题
- 懒加载 highlight.js 减少初始加载时间
- 异步音频流处理

### 内存管理
- 及时清理定时器
- 音频缓冲区重用
- 连接状态跟踪

## 测试和调试

### 调试日志
- WebSocket 连接状态
- 音频数据传输统计
- 转录结果和错误信息

### 测试工具
- 模拟音频输入
- 网络条件模拟
- 错误场景测试

---

**最后更新**: 2026-04-12
**版本**: 1.0
