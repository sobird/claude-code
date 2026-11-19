import type { Command } from '../../commands.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { renderFeedbackComponent } from '../feedback/feedback.js'

/**
 * /issue — ant-only capture flow for model-behavior problems (odd outputs,
 * wrong tool choices, hallucinations, refusals). Reuses the /feedback capture
 * UI so the report carries the transcript, model request, and git state.
 */
const call: LocalJSXCommandCall = async (onDone, context, args) => {
  return renderFeedbackComponent(onDone, context.abortController.signal, context.messages, args.trim())
}

const issue = {
  type: 'local-jsx',
  name: 'issue',
  description: 'Capture a model-behavior issue (odd outputs, wrong tool choices, refusals)',
  isEnabled: () => process.env.USER_TYPE === 'ant',
  load: () => Promise.resolve({ call }),
} satisfies Command

export default issue
