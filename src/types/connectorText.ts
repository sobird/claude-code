// Connector text types and utilities

export const CONNECTOR_TEXT_TYPES = {
  CONTINUE: 'continue',
  STOP: 'stop' as const,
}

export class ConnectorTextBlock {
  type: string
  content: unknown
  // Runtime marker read by `isConnectorTextBlock`. Not serialized by toJSON.
  _isConnectorTextBlock = true
  // Streaming accumulators the Messages API mutates on a connector_text block
  // (see `ConnectorTextDelta` / the `content_block_delta` handler in
  // services/api/claude.ts). Type-only — instances may only carry `content`.
  declare connector_text: string
  declare text: string
  declare thinking: string
  declare signature: string
  declare input: string

  constructor(type: string, content: unknown) {
    this.type = type
    this.content = content
  }

  toJSON() {
    return {
      type: this.type,
      content: this.content,
    }
  }
}

/**
 * Check if a value is a connector text block
 */
export function isConnectorTextBlock(value: unknown): value is ConnectorTextBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_isConnectorTextBlock' in value &&
    value._isConnectorTextBlock === true
  )
}

/**
 * Create a continue connector text block
 */
export function createContinueConnector(content: unknown): ConnectorTextBlock {
  return new ConnectorTextBlock(CONNECTOR_TEXT_TYPES.CONTINUE, content)
}

/**
 * Create a stop connector text block
 */
export function createStopConnector(content: unknown): ConnectorTextBlock {
  return new ConnectorTextBlock(CONNECTOR_TEXT_TYPES.STOP, content)
}

export type ConnectorTextDelta = {
  type: string
  connector_text: string
  text?: string
  thinking?: string
  // A `signature_delta` always carries the signature it streams.
  signature: string
  [key: string]: unknown
}
