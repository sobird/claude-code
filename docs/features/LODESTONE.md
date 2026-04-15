# LODESTONE Feature Flag 详细分析

LODESTONE 是 Claude Code 中的一个重要 feature flag，主要用于**深度链接（Deep Linking）功能**。以下是它的详细作用分析：

## 🎯 核心功能

**Lodestone = 深度链接协议处理系统**

LODESTONE 启用的主要功能包括：

1. **OS 级 URL Scheme 注册**
   - macOS: 创建 `claude-cli://` 协议的 `.app` 应用束
   - Linux: 创建 `.desktop` 文件和 xdg-mime 注册
   - Windows: 注册表项配置

2. **深度链接 URI 处理**
   - 解析 `claude-cli://open?q=prompt&cwd=/path&repo=owner/repo` 格式的链接
   - 支持预填充 prompt、指定工作目录、选择仓库等功能

3. **终端集成**
   - 在新终端窗口中打开 Claude Code
   - 保持与原始终端相同的二进制路径

## 🔧 技术实现细节

### 启用条件
- 通过 `tengu_lodestone_enabled` 实验性 flag 控制
- 在 `backgroundHousekeeping.ts` 中自动检查并注册协议处理器

### 关键代码流程
```typescript
// main.tsx 中的早期处理
if (feature('LODESTONE')) {
  const handleUriIdx = process.argv.indexOf('--handle-uri')
  if (handleUriIdx !== -1 && process.argv[handleUriIdx + 1]) {
    // 解析 URI 并启动新的终端实例
    const uri = process.argv[handleUriIdx + 1]!
    const { handleDeepLinkUri } = await import('./utils/deepLink/protocolHandler.js')
    const exitCode = await handleDeepLinkUri(uri)
    process.exit(exitCode)
  }
}
```

### 支持的 URI 参数
- `q`: 预填充的 prompt 文本
- `cwd`: 指定工作目录的绝对路径
- `repo`: GitHub 仓库 slug (如 `owner/repo`)

## 🌐 使用场景

1. **浏览器集成**
   ```html
   <a href="claude-cli://open?q=fix+bug+in+login">Fix Login Bug</a>
   ```

2. **外部应用集成**
   - IDE 插件生成深度链接
   - CI/CD 流水线触发特定任务
   - 文档中的可点击链接

3. **开发工作流程**
   - 从 issue tracker 直接跳转到相关代码
   - 从代码编辑器快速启动 Claude Code
   - 跨设备同步工作环境

## 📊 平台特定的实现

### macOS
- 创建 `~/Applications/Claude Code URL Handler.app`
- 包含 Info.plist 配置 URL scheme
- 使用符号链接指向实际的 claude 二进制文件

### Linux
- 创建 `~/.local/share/applications/claude-code-url-handler.desktop`
- 配置 xdg-mime 默认 handler
- 支持大多数桌面环境

### Windows
- 注册表项 `HKEY_CURRENT_USER\Software\Classes\claude-cli`
- 配置 shell 命令关联

## ⚙️ 配置和管理

### 禁用选项
用户可以通过设置 `disableDeepLinkRegistration: 'disable'` 来禁用自动注册

### 故障恢复
- 自动检测已注册的处理器是否有效
- 无效时自动重新注册
- 权限错误时有 24 小时的退避时间

### 调试和日志
- 记录 deep link 处理事件到 analytics
- 详细的调试日志用于故障排除
- 支持 `--handle-uri` CLI 参数手动测试

## 🔒 安全考虑

1. **输入验证**
   - 拒绝包含 ASCII 控制字符的输入（防止命令注入）
   - 限制 query 长度（最多 5000 字符）
   - 验证 cwd 必须是绝对路径

2. **路径安全性**
   - 只接受绝对路径作为工作目录
   - 验证 repo slug 格式防止路径遍历
   - 所有 shell 参数都经过转义处理

## 📈 影响和用途

### 主要优势
- **无缝集成**: 让 Claude Code 能够被其他应用调用
- **工作流自动化**: 支持基于链接的自动化工作流
- **用户体验**: 提供一致的跨平台体验
- **开发者友好**: 便于构建生态系统工具

### 适用场景
- 代码审查和问题跟踪系统集成
- IDE 和编辑器的扩展支持
- 团队协作工具的工作流集成
- 文档和可交互内容的创建

总之，LODESTONE 是 Claude Code 的"深度链接基础设施"，它使得操作系统级别的 URL 协议处理成为可能，从而实现了与其他应用的深度集成和自动化工作流的构建。