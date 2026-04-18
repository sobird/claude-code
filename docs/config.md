# 配置项说明

## hasCompletedOnboarding

**类型**: `boolean | undefined`

**默认值**: `undefined`

### 功能说明

`hasCompletedOnboarding` 是一个布尔类型的配置标志，用于跟踪用户是否已完成 Claude Code 应用的初始设置流程（onboarding）。

### 使用场景

- **首次启动控制**: 当该标志为 `false` 或 `undefined` 时，应用会强制显示交互式引导界面（onboarding dialog），要求用户完成初始设置
- **跳过引导**: 当标志设置为 `true` 时，应用会跳过引导流程，直接进入正常使用状态
- **持久化存储**: 该配置会保存在全局配置中，跨会话保持状态，避免用户每次启动都要重新进行设置

### 状态流转

1. **初始状态**: `undefined` - 用户首次安装或重置后
2. **显示引导**: 应用检测到未完成的 onboarding，展示引导界面
3. **完成设置**: 用户成功通过 OAuth 认证并完成配置后，标志被设为 `true`
4. **登录重置**: 用户注销登录时，该标志会被重置为 `false`，允许重新进行 onboarding

### 相关文件

- 配置文件位置: `src/utils/config.ts:198`
- 逻辑处理位置: `src/cli/handlers/auth.ts:169-170`
- 界面控制位置: `src/interactiveHelpers.tsx:145`

### 典型用途

```typescript
// 检查是否需要显示 onboarding
if (!config.hasCompletedOnboarding) {
  // 显示引导界面
}

// 标记 onboarding 完成
saveGlobalConfig(current => ({
  ...current,
  hasCompletedOnboarding: true
}));
```