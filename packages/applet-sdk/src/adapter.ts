// Abstract bridge adapter interface for host communication.

export interface BridgeAdapter {
  invoke(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onEvent(handler: (topic: string, payload: unknown) => void): () => void;
  readonly name: string;
}
