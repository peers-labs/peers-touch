// Bridge communication protocol types between host and applet.

export interface BridgeEnvelope {
  id: string;
  type: 'request' | 'response' | 'event';
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface BridgeEvent {
  topic: string;
  payload: unknown;
}

export interface BridgeInitMessage {
  type: 'init';
  protocol: string;
  version: string;
  capabilities: string[];
}
