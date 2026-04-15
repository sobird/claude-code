# CHICAGO_MCP Feature Flag 详细分析

## 🎯 核心作用

`CHICAGO_MCP` feature flag 控制 **Computer Use MCP** 功能的集成 - 一个专门用于计算机自动化和控制的自定义模型上下文协议(MCP)服务器。

## 📋 启用功能组件

### 1. Computer Use MCP Server
- **服务器名称**: `computer-use` (在 `src/utils/computerUse/common.ts` 中定义)
- **入口点**: `--computer-use-mcp` CLI 参数
- **依赖包**: `@ant/computer-use-mcp` (外部依赖)
- **功能**: 提供计算机自动化、截图、鼠标键盘控制的工具

### 2. 保留的 MCP 名称保护
防止用户配置冲突的 MCP 服务器:
- `claude-in-chrome` (保留给 Chrome 集成)
- `computer-use` (保留给 Computer Use MCP)

### 3. 内置 MCP 配置
- 将 `computer-use` 添加到内置 MCP 服务器名称列表
- 默认配置为禁用状态(需要显式通过 `enabledMcpServers` 启用)

### 4. 平台特定功能 (仅 macOS)
- 终端检测和被截图隐藏排除
- 原生截图过滤功能
- macOS CLI 环境的宿主适配器配置

### 5. 清理和资源管理
在 turn 结束或中断时自动处理清理:
- 释放基于文件的锁
- 取消隐藏应用程序窗口
- 清理 Computer Use 资源

## 🏗️ 架构集成

```mermaid
graph TD
    A[CHICAGO_MCP Feature Flag] --> B[Computer Use MCP Server]
    A --> C[Reserved MCP Name Protection]
    A --> D[Built-in MCP Configuration]
    A --> E[macOS Platform Adaptations]
    A --> F[Automatic Cleanup Hooks]

    B --> G[@ant/computer-use-mcp Package]
    B --> H[--computer-use-mcp CLI Entry]
    B --> I[In-process Server Execution]
```

## 🔧 使用模式

### CLI 使用
```bash
# 启动 Computer Use MCP server
claude --computer-use-mcp
```

### 编程使用
```typescript
// 在客户端代码中
if (feature('CHICAGO_MCP')) {
  // 启用 Computer Use MCP tool overrides
  const overrides = computerUseWrapper().getComputerUseMCPToolOverrides(tool.name)
}
```

### 配置示例
```javascript
// MCP 配置文件 (默认为禁用)
{
  "mcpServers": {
    "computer-use": {
      "command": "claude",
      "args": ["--computer-use-mcp"]
    }
  },
  "enabledMcpServers": ["computer-use"] // 必须显式启用
}
```

## 🚀 主要优势

1. **计算机自动化**: 使 AI 能够通过 MCP 与桌面应用程序交互
2. **截图控制**: 原生截图捕获，可排除终端窗口
3. **鼠标/键盘输入**: 对输入设备的编程控制
4. **应用枚举**: 检测并列出已安装的应用程序以供自动化
5. **资源安全**: 自动清理防止资源泄漏

## ⚠️ 技术注意事项

- **仅限 macOS**: 所有平台特定功能都需要 macOS
- **GrowthBook Gate**: 运行时启用由 `tengu_malort_pedway` gate 控制
- **原生依赖**: 需要 `@ant/computer-use-input` 和 `@ant/computer-use-swift`
- **文件锁定**: 使用进程级基于文件的锁来保证安全
- **子代理隔离**: 仅限主线程 - 子代理不会启动 CU 会话

## 📊 当前状态

基于代码库分析，这似乎是 Anthropic 内部使用的企业级特性，提供了超出标准 CLI 操作的直接系统交互能力，可能用于需要直接系统交互的特殊工作流程。

"CHICAGO" 这个名称暗示这可能是一个项目或地点的内部代号。