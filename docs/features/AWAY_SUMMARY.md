# AWAY_SUMMARY Feature Flag 详细分析

AWAY_SUMMARY 是 Claude Code 中的一个 feature flag，主要用于**用户长时间离开时自动生成工作摘要**。以下是它的详细作用分析：

## 🎯 核心功能

**AWAY_SUMMARY = 离开摘要系统**

AWAY_SUMMARY 启用的主要功能包括：

1. **终端焦点检测**
   - 通过 DECSET 1004 检测终端窗口的聚焦状态
   - 支持 'focused', 'blurred', 'unknown' 三种状态
   - 自动识别用户是否离开了终端

2. **延迟触发机制**
   - 用户离开（终端失焦）后等待 5 分钟
   - 避免在用户临时切换窗口时打扰
   - 只有在没有进行中的对话时才触发

3. **智能摘要生成**
   - 基于最近的 30 条消息生成上下文摘要
   - 结合会话记忆提供 broader context
   - 使用轻量级模型快速生成摘要

4. **摘要内容规范**
   - 1-3 句话的简洁格式
   - 说明高-level task 和具体下一步
   - 跳过状态报告和 commit 回顾

## 🔧 技术实现细节

### 启用条件
- 通过 feature('AWAY_SUMMARY') 控制
- 还需要 `tengu_sedge_lantern` GrowthBook 实验性 flag 支持
- 默认未启用（在 scripts/config.ts 中被注释）

### 关键代码流程

```typescript
// 1. useAwaySummary hook 设置焦点监听
useEffect(() => {
  if (!feature('AWAY_SUMMARY')) return

  function onFocusChange() {
    const state = getTerminalFocusState()
    if (state === 'blurred') {
      // 5分钟后触发摘要生成
      timerRef.current = setTimeout(onBlurTimerFire, BLUR_DELAY_MS)
    } else if (state === 'focused') {
      clearTimer()
    }
  }

  const unsubscribe = subscribeTerminalFocus(onFocusChange)
})

// 2. 摘要生成服务
export async function generateAwaySummary(
  messages: readonly Message[],
  signal: AbortSignal,
): Promise<string | null> {
  const memory = await getSessionMemoryContent()
  const recent = messages.slice(-RECENT_MESSAGE_WINDOW)
  recent.push(createUserMessage({ content: buildAwaySummaryPrompt(memory) }))
  const response = await queryModelWithoutStreaming({
    messages: recent,
    model: getSmallFastModel(), // 使用快速轻量模型
    skipCacheWrite: true,
  })
  return getAssistantMessageText(response)
}
```

### 时间参数
- **BLUR_DELAY_MS**: 5 分钟（300,000 毫秒）
- **RECENT_MESSAGE_WINDOW**: 30 条消息（约 15 次交互）

### 摘要提示词结构
```
[Session memory (broader context)]
The user stepped away and is coming back. Write exactly 1-3 short sentences.
Start by stating the high-level task — what they are building or debugging, not implementation details.
Next: the concrete next step. Skip status reports and commit recaps.
```

## 📊 工作原理

### 触发条件
1. 终端失焦（blur）
2. 超过 5 分钟无活动
3. 当前没有进行中的对话
4. 距离上次用户消息后有 summary message

### 去重机制
- `hasSummarySinceLastUserTurn()` 检查最近是否有 summary
- 避免重复生成相同的摘要
- 基于用户消息和 system 消息类型判断

### Abort 处理
- 支持 AbortController 取消正在生成的摘要
- 当用户返回焦点时立即停止生成
- 防止资源浪费和 UI 闪烁

## 💾 数据依赖

### 会话记忆
- 从 `getSessionMemoryContent()` 获取 broader context
- 需要 SessionMemory 功能已启用并初始化
- 提供项目背景和历史信息

### 消息历史
- 只使用最近的 30 条消息
- 过滤 sidechain 消息（工具调用等）
- 保持摘要的相关性和时效性

## 🎯 使用场景

### 主要目的
1. **用户体验提升**: 让用户重新进入时快速了解进展
2. **工作效率**: 减少重新理解上下文的时间
3. **连续性**: 保持开发工作的连贯性
4. **团队协作**: 让团队成员了解工作状态

### 适用场景
- **长时间调试**: 用户离开解决复杂问题
- **代码重构**: 大型重构任务的中断恢复
- **文档编写**: 撰写技术文档时的中断
- **多任务处理**: 在不同任务间切换时的状态同步

## ⚙️ 配置和管理

### 启用方式
```javascript
// 在 config 文件中取消注释
'AWAY_SUMMARY',
```

### 禁用选项
- 保持默认禁用状态
- 需要用户明确启用

### 性能考虑
- 使用小型快速模型（getSmallFastModel）
- 跳过缓存写入（skipCacheWrite: true）
- 15 秒超时防止长时间等待

## 🔍 调试和监控

### 日志记录
- 记录摘要生成事件到 analytics
- 调试日志显示生成过程
- 错误处理和异常情况记录

### 状态跟踪
- 跟踪焦点状态变化
- 监控摘要生成进度
- 记录会话记忆加载情况

## 📈 影响和用途

### 主要优势
- **无缝恢复**: 用户离开后能快速回到工作状态
- **智能洞察**: 基于 AI 分析的上下文理解
- **时间节省**: 减少重新理解上下文的时间
- **工作流优化**: 提高开发效率

### 技术价值
- 支持复杂的长时间任务
- 提供可操作的下一步建议
- 增强用户对 AI 助手的信任
- 为产品决策提供用户体验数据

总之，AWAY_SUMMARY 是 Claude Code 的"智能工作流连续性系统"，它通过在用户离开时自动生成工作摘要，确保用户在返回时能够无缝继续之前的工作，显著提升了开发效率和用户体验。