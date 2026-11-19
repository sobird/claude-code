# WORKFLOW_SCRIPTS Feature Flag 详细分析

## 🎯 核心作用

`WORKFLOW_SCRIPTS` feature flag 启用 **声明式工作流**：用户在项目的 `.claude/workflows/` 下用 YAML/JSON 描述一串有序步骤，然后用 `/workflows` 列出、用模型经 **Workflow 工具**执行。它是“可复用的细粒度自动化脚本”，不是带触发器/调度器/可视化编辑器的完整编排平台。

## 📋 实现组成

| 模块          | 文件                                              | 职责                                                           |
| ------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| 定义加载/模板 | `src/tools/WorkflowTool/definitions.ts`           | 读取 `.claude/workflows/` 下的 YAML/JSON，规范化步骤，展开模板 |
| 命令生成      | `src/tools/WorkflowTool/createWorkflowCommand.ts` | 每个定义生成一个 `/workflow-<slug>` 提示命令                   |
| 列表命令      | `src/commands/workflows/workflows.ts`             | `/workflows` 渲染定义表格                                      |
| 执行          | `src/tools/WorkflowTool/WorkflowTool.ts`          | 模型调用（`action: run`/`list`/`describe`）时逐步执行          |
| 接线          | `src/commands.ts`                                 | `feature('WORKFLOW_SCRIPTS')` 为真时注入上述命令               |

## 🔧 定义格式

工作流文件位于 **当前工作目录下的 `.claude/workflows/`**，扩展名为 `.yaml` / `.yml` / `.json`。一个定义包含 `name`、可选 `description` / `version`，以及一个 `steps` 数组（必须有非空 `steps`，否则该文件被跳过）。

```yaml
# .claude/workflows/review.yaml
name: review
description: Review the staged changes then write a report
steps:
  - name: scan # 可选，缺省显示为 "Step N"
    action: agent # agent | shell | write_file
    prompt: Review the staged changes for bugs.
    timeout: 300 # 可选，秒

  - name: report
    action: write_file
    path: reports/review.md
    content: '{{step_1.result}}'

  - name: test
    action: shell
    command: npm test
```

### 步骤动作

`resolveStepAction()` 决定每个步骤如何执行：

- `shell`：`command` 经 `bash -c` 运行。
- `write_file`：把 `content` 写到相对于 cwd 的 `path`。
- `agent`：以 `prompt` 发起一个 agent 回合。

若未显式写 `action`，会依据存在的字段推断：有 `prompt` → `agent`，有 `path` → `write_file`，否则 `shell`。`type` 可作为 `action` 的旧写法回退。

### 模板

步骤执行前，对 `command` / `content` / `prompt` 展开：

- `{{args}}`：本命令收到的全部参数（空格连接）；`{{args.N}}`：第 N 个参数（从 1 开始）。
- `{{step_N.result}}` 或 `{{steps.N.output}}`：第 N 个已完成步骤的输出。

### 排序

步骤按**声明顺序**执行。定义中的 `depends_on` 会被解析接受，但**不参与排序**（仅作元数据保留）。

## 🚀 使用方式

```bash
# 列出当前项目的工作流
/workflows

# 运行某个工作流（参数会按空白拆分后注入模板）
/workflow-review
/workflow-review --since HEAD~3
```

`/workflows` 输出 NAME / STEPS / DESCRIPTION 三列表格；没有定义时提示去 `.claude/workflows` 创建。

`/workflow-<slug>` 是 `getWorkflowCommands()` 为每个定义生成的 **prompt 命令**：命令名由工作流名 slugify 得到，调用时把一段说明（含 `{"action":"run","name":...}` 与步骤清单）作为提示注入，由模型调用 Workflow 工具真正执行。

## 🧭 作用域与约束

- **项目作用域**：只加载 `getOriginalCwd()` 下的 `.claude/workflows/`，不存在则返回空。
- **去重**：多个文件声明同名工作流时，仅保留第一个；列表按名称排序。
- **解析失败即跳过**：单个文件 YAML/JSON 解析失败或缺少 `steps` 不会中断加载，仅记录调试日志。
- **无触发器/无调度**：没有 `triggers`、`schedule`、`notifications` 等字段——执行完全由用户显式调用 `/workflow-<slug>` 触发。

## ⚠️ 构建与开关

- 受 `feature('WORKFLOW_SCRIPTS')` 控制，已在 `scripts/config.ts` 启用。
- 通过 `require()` 动态加载，便于按 flag 做死代码消除。

## 相关文件

- 代码：`src/tools/WorkflowTool/`、`src/commands/workflows/`
- 前端：无（无 UI 对话框；`/workflows` 与 `/workflow-<slug>` 均为文本/prompt 命令）
