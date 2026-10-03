export type OpenCreatedAgentProfile = (agentName: string) => void;

export interface AgentCreateRequest {
  id: number;
  openProfile: OpenCreatedAgentProfile;
}

type Listener = () => void;

let activeRequest: AgentCreateRequest | null = null;
let requestSequence = 0;
const listeners = new Set<Listener>();

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

export function openAgentCreateFlow(openProfile: OpenCreatedAgentProfile): void {
  if (activeRequest) return;
  requestSequence += 1;
  activeRequest = {
    id: requestSequence,
    openProfile,
  };
  emitChange();
}

export function closeAgentCreateFlow(requestId: number): void {
  if (activeRequest?.id !== requestId) return;
  activeRequest = null;
  emitChange();
}

export function subscribeAgentCreateFlow(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAgentCreateRequest(): AgentCreateRequest | null {
  return activeRequest;
}
