/** Queue transition logged to the session transcript (see messageQueueManager). */
export type QueueOperation = 'enqueue' | 'dequeue' | 'remove' | 'popAll'

/** Session transcript entry recording a command-queue transition. */
export type QueueOperationMessage = {
  type: 'queue-operation'
  operation: QueueOperation
  timestamp: string
  sessionId: string
  /** Command text, when the operation carries one. */
  content?: string
}
