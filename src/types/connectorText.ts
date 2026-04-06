// Connector text types and utilities

export const CONNECTOR_TEXT_TYPES = {
  CONTINUE: 'continue',
  STOP: 'stop' as const
};

export class ConnectorTextBlock {
  type: string;
  content: any;

  constructor(type: string, content: any) {
    this.type = type;
    this.content = content;
    (this as any)._isConnectorTextBlock = true;
  }

  toJSON() {
    return {
      type: this.type,
      content: this.content
    };
  }
}

/**
 * Check if a value is a connector text block
 */
export function isConnectorTextBlock(value: any): value is ConnectorTextBlock {
  return value &&
         typeof value === 'object' &&
         '_isConnectorTextBlock' in value &&
        (value as any)._isConnectorTextBlock === true;
}

/**
 * Create a continue connector text block
 */
export function createContinueConnector(content: any): ConnectorTextBlock {
  return new ConnectorTextBlock(CONNECTOR_TEXT_TYPES.CONTINUE, content);
}

/**
 * Create a stop connector text block
 */
export function createStopConnector(content: any): ConnectorTextBlock {
  return new ConnectorTextBlock(CONNECTOR_TEXT_TYPES.STOP, content);
}

export type ConnectorTextDelta = {
  type: string;
  connector_text: string;
  text?: string;
  thinking?: string;
  signature?: string;
  [key: string]: unknown
}
