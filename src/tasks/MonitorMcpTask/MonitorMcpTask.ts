import type { AppState } from '../../state/AppState.js'
import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import type { AgentId } from '../../types/ids.js'
import { logForDebugging } from '../../utils/debug.js'
import { evictTaskOutput } from '../../utils/task/diskOutput.js'
import { updateTaskState } from '../../utils/task/framework.js'

/**
 * Background task that follows an MCP server's connection state.
 *
 * Upstream registers one of these per `Monitor` call and keeps it alive until
 * the user stops it. This tree runs the bounded polling variant in MonitorTool
 * instead, but the task type stays registered so the background-task UI, the
 * kill path, and agent orphan cleanup have a consistent shape.
 */
export type MonitorMcpTaskState = TaskStateBase & {
  type: 'monitor_mcp'
  /** Aborts the observation loop; cleared once the task reaches a terminal state. */
  abortController?: AbortController
  /** Agent that spawned this monitor, when it is not the main session. */
  agentId?: AgentId
}

/**
 * Kill a monitor task. No-op if it is already terminal (completed/failed/killed).
 */
export function killMonitorMcp(taskId: string, setAppState: SetAppState): void {
  let killed = false
  updateTaskState<MonitorMcpTaskState>(taskId, setAppState, (task) => {
    if (task.status !== 'running') {
      return task
    }
    killed = true
    task.abortController?.abort()
    return {
      ...task,
      status: 'killed',
      notified: true,
      endTime: Date.now(),
      abortController: undefined,
    }
  })
  if (killed) {
    void evictTaskOutput(taskId)
  }
}

/**
 * Kill all running monitor tasks spawned by a given agent.
 * Called from runAgent.ts's finally block so a watcher does not outlive the
 * agent that started it.
 */
export function killMonitorMcpTasksForAgent(
  agentId: AgentId,
  getAppState: () => AppState,
  setAppState: SetAppState,
): void {
  const tasks = getAppState().tasks ?? {}
  for (const [taskId, task] of Object.entries(tasks)) {
    if (task.type === 'monitor_mcp' && task.agentId === agentId && task.status === 'running') {
      logForDebugging(`killMonitorMcpTasksForAgent: killing orphaned monitor ${taskId} (agent ${agentId} exiting)`)
      killMonitorMcp(taskId, setAppState)
    }
  }
}

export const MonitorMcpTask: Task = {
  name: 'MonitorMcpTask',
  type: 'monitor_mcp',

  async kill(taskId, setAppState) {
    killMonitorMcp(taskId, setAppState)
  },
}
