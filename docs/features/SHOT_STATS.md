# SHOT_STATS Feature Flag 详细分析

SHOT_STATS 是 Claude Code 中的一个 feature flag，主要用于**统计和分析 Claude Code 的 "shot"（猜测/重试）行为数据**。以下是它的详细作用分析：

## 🎯 核心功能

**SHOT_STATS = Shot 统计系统**

SHOT_STATS 启用的主要功能包括：

1. **Shot 计数提取**
   - 从 `gh pr create` 命令的执行中自动提取 shot 数量
   - 识别格式为 "N-shotted by model-name" 的 PR 归属文本
   - 支持嵌套子代理会话的去重处理

2. **Shot 分布统计分析**
   - 统计不同 shot 数量的会话分布
   - 计算平均 shot 数量
   - 计算 one-shot 成功率
   - 按区间分组统计（1-shot, 2-5 shots, 6-10 shots, 11+ shots）

3. **数据缓存和持久化**
   - 将 shot 统计数据缓存到本地文件
   - 支持跨会话的数据合并
   - 自动迁移旧版本缓存格式

## 🔧 技术实现细节

### 启用条件
- 通过 feature flag 控制，默认未启用
- 在 `scripts/config.ts` 中被注释掉，需要手动启用

### 关键代码流程

```typescript
// 1. 在 stats.ts 中初始化 shot 统计映射
const shotDistributionMap = feature('SHOT_STATS')
  ? new Map<number, number>()
  : undefined

// 2. 处理会话文件时提取 shot 计数
if (feature('SHOT_STATS') && shotDistributionMap) {
  const shotCount = extractShotCountFromMessages(messages)
  if (shotCount !== null) {
    shotDistributionMap.set(shotCount, (shotDistributionMap.get(shotCount) || 0) + 1)
  }
}

// 3. 生成统计结果
if (feature('SHOT_STATS') && shotDistributionMap) {
  return { shotDistribution: Object.fromEntries(shotDistributionMap) }
}
```

### Shot 计数提取规则
- **正则表达式**: `/(\d+)-shotted by/`
- **数据来源**: `gh pr create` 命令的工具调用输入
- **格式示例**: `"4-shotted by claude-3-sonnet"`
- **去重机制**: 基于 parent session ID 避免子代理重复统计

### 支持的 shot 数量区间
- `1`: 1-shot (直接成功)
- `2-5`: 少量重试
- `6-10`: 中等重试次数
- `11+`: 大量重试

## 📊 统计指标

### 主要指标
- **平均 shot 数**: `totalShots / totalSessions`
- **one-shot 率**: `(1-shot sessions / total sessions) * 100%`
- **分布直方图**: 各 shot 区间的会话数量占比

### UI 展示
在 Stats 组件中显示：
```
Shot stats (ant-only):
• 1-shot: 15 (60%)
• 2-5 shots: 8 (32%)
• 6-10 shots: 2 (8%)
• 11+ shots: 0 (0%)
• Average: 2.3
```

## 💾 数据存储和缓存

### 缓存机制
- **文件位置**: 在 stats cache 中包含 `shotDistribution` 字段
- **数据结构**: `{ [shotCount: number]: number }`
- **合并策略**: 新数据与现有缓存数据合并
- **迁移支持**: 自动处理旧版本缓存格式缺失的情况

### 缓存更新
- 当启用 SHOT_STATS 但缓存缺少 shotDistribution 时，强制重新计算历史数据
- 支持增量更新，只添加新的会话数据

## 🎯 使用场景

### 主要目的
1. **性能分析**: 了解 Claude Code 的平均重试次数和成功率
2. **模型评估**: 评估不同模型的 shot 效率和可靠性
3. **用户体验**: 提供关于 AI 助手效率的量化数据
4. **产品决策**: 数据驱动的产品优化和改进方向

### 适用场景
- **开发团队**: 了解团队协作中的 AI 使用模式
- **产品分析**: 分析用户交互效率和满意度
- **模型选择**: 比较不同 AI 模型的性能表现
- **培训教育**: 帮助新用户理解 Claude Code 的工作方式

## ⚙️ 配置和管理

### 启用方式
```javascript
// 在 config 文件中取消注释
'SHOT_STATS',
```

### 禁用选项
- 保持默认禁用状态（在 scripts/config.ts 中被注释）
- 需要开发者或测试人员手动启用进行测试

### 数据隐私
- 统计的是本地执行的 shot 数据
- 不包含敏感的用户信息
- 所有数据处理都在本地完成

## 🔍 调试和监控

### 日志记录
- 记录 shot 数据统计过程到 debug 日志
- 缓存迁移时的详细日志
- 错误处理和异常情况记录

### 验证机制
- 缓存结构验证，确保数据完整性
- Shot 计数提取的边界情况处理
- 空数据和异常数据的容错处理

## 📈 影响和用途

### 主要优势
- **数据洞察**: 提供关于 AI 助手效率的量化指标
- **性能优化**: 识别需要改进的重试场景
- **用户体验**: 让用户了解 AI 助手的实际工作方式
- **产品改进**: 基于真实使用数据的持续优化

### 技术价值
- 支持复杂会话的统计分析
- 提供可操作的统计指标
- 支持长期趋势分析
- 为产品决策提供数据支撑

总之，SHOT_STATS 是 Claude Code 的"AI 助手效率分析系统"，它通过统计和分析 Claude Code 执行任务时的重试行为，为用户提供关于 AI 助手性能和效率的宝贵洞察。