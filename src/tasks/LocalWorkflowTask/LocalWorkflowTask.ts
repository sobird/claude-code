import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { logForDebugging } from '../../utils/debug.js'
import { evictTaskOutput } from '../../utils/task/diskOutput.js'
import { updateTaskState } from '../../utils/task/framework.js'

export type WorkflowAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'killed'

/** One agent launched by a workflow script, as tracked for the detail dialog. */
export type WorkflowAgentState = {
  id: string
  /** Step name / role from the workflow script, when it names its agents. */
  name?: string
  status: WorkflowAgentStatus
}

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  summary?: string
  description: string
  workflowName?: string
  agentCount: number
  /** Agents the workflow has launched, in display order. */
  agents?: WorkflowAgentState[]
  /**
   * Abort handles for in-flight agents, keyed by agent id. A Map (not a
   * Record) so mutating it does not change the container's identity — the
   * same pattern as SessionHooksState (see utils/hooks/sessionHooks.ts).
   */
  agentControllers?: Map<string, AbortController>
  /** Aborts the whole workflow run. */
  abortController?: AbortController
}

function isActive(status: WorkflowAgentStatus): boolean {
  return status === 'running' || status === 'pending'
}

/**
 * Kill a whole workflow: abort the run and every in-flight agent.
 * No-op if the task is already terminal.
 */
export function killWorkflowTask(id: string, setAppState: SetAppState): void {
  let killed = false
  updateTaskState<LocalWorkflowTaskState>(id, setAppState, (task) => {
    if (task.status !== 'running') {
      return task
    }
    killed = true
    task.abortController?.abort()
    for (const controller of task.agentControllers?.values() ?? []) {
      controller.abort()
    }
    task.agentControllers?.clear()
    return {
      ...task,
      status: 'killed',
      endTime: Date.now(),
      notified: true,
      abortController: undefined,
      agents: task.agents?.map((agent) => (isActive(agent.status) ? { ...agent, status: 'killed' as const } : agent)),
    }
  })
  if (killed) {
    void evictTaskOutput(id)
  }
}

/**
 * Skip a single agent without killing the rest of the workflow. Aborting the
 * agent's controller makes the runner treat it as finished; the recorded
 * status drives the detail dialog.
 */
export function skipWorkflowAgent(id: string, agentId: string, setAppState: SetAppState): void {
  updateTaskState<LocalWorkflowTaskState>(id, setAppState, (task) => {
    if (task.status !== 'running') {
      return task
    }
    const agent = task.agents?.find((a) => a.id === agentId)
    const controller = task.agentControllers?.get(agentId)
    if (!agent && !controller) {
      return task
    }
    controller?.abort()
    task.agentControllers?.delete(agentId)
    logForDebugging(`Skipping workflow agent ${agentId} of task ${id}`)
    return {
      ...task,
      agents: task.agents?.map((a) =>
        a.id === agentId && isActive(a.status) ? { ...a, status: 'skipped' as const } : a,
      ),
    }
  })
}

/**
 * Re-queue an agent that failed, was skipped, or was killed. Resets its
 * status to `pending`; the workflow runner re-launches pending agents.
 */
export function retryWorkflowAgent(id: string, agentId: string, setAppState: SetAppState): void {
  updateTaskState<LocalWorkflowTaskState>(id, setAppState, (task) => {
    if (task.status !== 'running') {
      return task
    }
    const agent = task.agents?.find((a) => a.id === agentId)
    if (!agent || (agent.status !== 'failed' && agent.status !== 'skipped' && agent.status !== 'killed')) {
      return task
    }
    logForDebugging(`Retrying workflow agent ${agentId} of task ${id}`)
    return {
      ...task,
      agents: task.agents?.map((a) => (a.id === agentId ? { ...a, status: 'pending' as const } : a)),
    }
  })
}

export const LocalWorkflowTask: Task = {
  name: 'LocalWorkflowTask',
  type: 'local_workflow',

  async kill(taskId, setAppState) {
    killWorkflowTask(taskId, setAppState)
  },
}
