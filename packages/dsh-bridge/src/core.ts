/** 独立桥与 dsh 插件共用的纯逻辑入口：RCS 客户端、事件/审批翻译与守卫。 */
export { RcsClient } from './rcs'
export type { RequiresActionDetails, WorkerFrame, WorkerSession, WorkerStatus } from './rcs'
export {
  allowRulesOf,
  approvalOutcome,
  approvalRequestEvent,
  approvalResult,
  parseControlResponse,
  promptBlocks,
  questionRequestEvent,
  questionResult,
  translateSessionEvent,
} from './translate'
export type { ControlResolution, DshPromptBlock, DshSessionEvent, RcsEvent } from './translate'
export { asArray, asNumber, asText, errorMessage, isRecord, parseJsonObject, stripTrailingSlash } from './util'
