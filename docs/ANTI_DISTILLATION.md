# 反蒸馏（Anti-Distillation）机制

## 概述

本项目实现了多层反蒸馏保护机制，通过多种技术手段防止模型蒸馏攻击，确保AI行为的安全性和隐私性。

## 相关文件

### 1. src/services/api/claude.ts
**主要功能**：实现fake_tools反蒸馏机制
- **位置**：第301-313行
- **实现细节**：
  - 为第一方CLI客户端提供anti_distillation选项
  - 通过`fake_tools`选项向API发送反蒸馏保护请求
  - 仅在满足特定条件时启用（ANTI_DISTILLATION_CC功能标志、CLI入口点、内部beta用户）

### 2. src/utils/streamlinedTransform.ts
**主要功能**：抗蒸馏输出格式
- **位置**：第4-9行（文档注释）
- **设计目标**：
  - Streamlined mode被设计为"distillation-resistant"（抗蒸馏）输出格式
  - 保持文本消息完整性
  - 对工具调用进行累积计数摘要（当出现文本时重置）
  - 省略思考内容
  - 从初始化消息中剥离工具列表和模型信息

### 3. src/utils/betas.ts
**主要功能**：服务端反蒸馏POC
- **位置**：第279-283行
- **实现细节**：
  - 服务端连接器文本摘要原型（Proof of Concept）
  - 在工具调用之间缓冲助手文本并进行摘要
  - 返回带有签名的摘要，以便后续恢复原始文本
  - 使用与thinking blocks相同的机制
  - 目前仅限内部研究用途

## 技术实现

### fake_tools机制
```typescript
// Anti-distillation: send fake_tools opt-in for 1P CLI only
if (
  feature('ANTI_DISTILLATION_CC')
    ? process.env.CLAUDE_CODE_ENTRYPOINT === 'cli'
    && shouldIncludeFirstPartyOnlyBetas()
    && getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_anti_distill_fake_tool_injection',
      false,
    )
    : false
) {
  result.anti_distillation = ['fake_tools']
}
```

### 服务端摘要机制
- 缓冲assistant文本片段
- 生成摘要并附加签名
- 保持TTFT/TTLT/capacity指标的同时提供反蒸馏保护

## 安全考虑

1. **访问控制**：反蒸馏功能仅对特定的客户端和环境启用
2. **功能隔离**：服务端摘要功能需要Capability.ANTHROPIC_INTERNAL_RESEARCH权限
3. **向后兼容**：所有反蒸馏机制都设计为可选的，不影响正常功能

## 未来发展方向

- 完善服务端摘要算法
- 扩展反蒸馏保护到其他客户端类型
- 优化性能影响（TTFT/TTLT）
- 增加更多反蒸馏策略选项
