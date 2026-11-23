/**
 * 用户消息的投递通道（随 `user` 事件 payload 的 `delivery` 字段下发）。
 *
 * - `steer`（默认）：插话——CLI 在当前工具调用结束、下一次 API 往返前注入。
 * - `queue`：排队——等本轮结束再作为新 query 处理。
 *
 * 仅在 agent 运行中才有区别；空闲时两者都立即开始新的一轮。
 */

export type SubmitDelivery = 'steer' | 'queue'
