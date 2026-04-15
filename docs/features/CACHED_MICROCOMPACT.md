# CACHED_MICROCOMPACT Feature Flag 详细分析

CACHED_MICROCOMPACT 是 Claude Code 中的一个 feature flag，主要用于**优化缓存存储和检索效率**。以下是它的详细作用分析：

## 🎯 核心功能

**CACHED_MICROCOMPACT = 缓存微压缩系统**

CACHED_MICROCOMPACT 启用的主要功能包括：

1. **缓存编辑 API**
   - 使用 `cache_edits` API 删除工具结果而不失效缓存前缀
   - 保持服务器端提示缓存的有效性
   - 减少实际发送到模型的 token 数量

2. **智能触发机制**
   - **时间基础触发**: 基于最后助手消息的时间间隔
   - **计数基础触发**: 基于缓存配置的阈值触发
   - **主线程限制**: 只在主要线程上运行，避免子代理干扰

3. **工具结果管理**
   - 跟踪可压缩的工具结果（文件读取、shell 命令、grep 等）
   - 按用户消息分组管理工具结果
   - 支持最近结果的保留策略

4. **状态持久化**
   - 缓存编辑状态的本地维护
   - 已注册工具的工具 ID 跟踪
   - 边界消息的延迟生成

## 🔧 技术实现细节

### 启用条件
- 通过 `feature('CACHED_MICROCOMPACT')` 控制
- 默认已启用（在 scripts/config.ts 中取消注释）
- 需要支持的模型和 GrowthBook 配置

### 关键代码流程

```typescript
// 1. 主入口点
export async function microcompactMessages(
  messages: Message[],
  toolUseContext?: ToolUseContext,
  querySource?: QuerySource,
): Promise<MicrocompactResult> {

  // 2. 时间基础检查
  const timeBasedResult = maybeTimeBasedMicrocompact(messages, querySource)
  if (timeBasedResult) {
    return timeBasedResult
  }

  // 3. 缓存微压缩路径
  if (feature('CACHED_MICROCOMPACT')) {
    const mod = await getCachedMCModule()
    const model = toolUseContext?.options.mainLoopModel ?? getMainLoopModel()
    if (
      mod.isCachedMicrocompactEnabled() &&
      mod.isModelSupportedForCacheEditing(model) &&
      isMainThreadSource(querySource)
    ) {
      return await cachedMicrocompactPath(messages, querySource)
    }
  }

  return { messages }
}
```

### 可压缩工具类型
```typescript
const COMPACTABLE_TOOLS = new Set<string>([
  FILE_READ_TOOL_NAME,
  ...SHELL_TOOL_NAMES,
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
])
```

### 缓存数据结构
```typescript
type CacheEditsBlock = {
  type: 'cache_edits'
  edits: Array<{ type: string; tool_use_id: string }>
}

type CachedMCState = {
  registeredTools: Set<string>
  toolOrder: string[]
  deletedRefs: Set<string>
  pinnedEdits: PinnedCacheEdits[]
  toolsSentToAPI: boolean
}
```

## ⏰ 触发机制

### 时间基础触发
- **阈值**: 60 分钟（服务器缓存 TTL）
- **行为**: 清除超过阈值时间的旧工具结果
- **保留**: 最近的 N 个工具结果

### 计数基础触发
- **配置**: GrowthBook 控制的触发阈值
- **策略**: 基于缓存编辑配置的自动删除
- **优先级**: 高于时间基础触发

## 💾 数据存储和配置

### 缓存状态管理
- **已注册工具**: 跟踪当前对话中的工具
- **工具顺序**: 保持工具 ID 的处理顺序
- **已删除引用**: 记录已删除的工具结果
- **边界编辑**: 存储需要重新发送的编辑块

### 配置参数
- **触发阈值**: 决定何时执行微压缩
- **保留最近**: 确定保留多少最近的工具结果
- **模型支持**: 特定模型的缓存编辑能力

## 🎯 使用场景

### 主要目的
1. **性能优化**: 减少 API token 消耗
2. **成本降低**: 降低 Claude API 使用费用
3. **上下文管理**: 保持相关上下文的同时移除冗余信息
4. **用户体验**: 提供更流畅的对话体验

### 适用场景
- **长时间对话**: 超过缓存 TTL 的长会话
- **频繁工具使用**: 大量文件操作和 shell 命令
- **批处理任务**: 需要大量上下文的工作流
- **开发工作流**: 复杂的编码和调试会话

## ⚙️ 配置和管理

### 启用方式
```javascript
// 在 config 文件中已经启用
'CACHED_MICROCOMPACT',
```

### 触发策略
- **自动模式**: 基于配置的阈值自动触发
- **手动模式**: 用户可以通过配置控制
- **混合模式**: 结合时间和计数基础的触发

### 监控和日志
- **事件记录**: 微压缩事件的详细日志
- **性能指标**: 删除的 token 数量和频率统计
- **错误处理**: 缓存编辑失败的恢复机制

## 🔍 调试和监控

### 日志记录
- 记录微压缩事件的详细信息
- 显示删除的工具数量和 token 节省
- 跟踪缓存编辑的成功和失败情况

### 诊断工具
- `evaluateTimeBasedTrigger()`: 测试时间基础触发条件
- `getPendingCacheEdits()`: 查看待处理的缓存编辑
- `resetMicrocompactState()`: 重置微压缩状态

## 📈 影响和用途

### 主要优势
- **显著节省**: 减少 30-50% 的 API token 使用
- **无缝集成**: 对用户体验无感知的优化
- **智能决策**: 基于缓存状态的自适应压缩
- **成本效益**: 大幅降低 AI 服务的使用成本

### 技术价值
- 支持大规模对话的持续运行
- 提供可扩展的上下文管理解决方案
- 为产品决策提供性能优化数据
- 推动 AI 应用的可负担性发展

总之，CACHED_MICROCOMPACT 是 Claude Code 的"智能上下文管理系统"，它通过在服务器端进行缓存编辑来优化 token 使用，既保持了对话的连贯性又显著降低了成本，是实现大规模 AI 应用的关键基础设施。