import { sdk } from '@peers-touch/applet-sdk';
import type { AgentResponse, Connection, SessionInfo } from './types';

const CONNECTIONS_KEY = 'remote-cli.connections.v1';
const SESSIONS_KEY = 'remote-cli.sessions.v1';

interface SSHConfigHost {
  alias: string;
  hostname: string;
  user?: string;
  port?: number;
  identity_file?: string;
}

interface SSHKeyFile {
  path: string;
  name: string;
  has_pub: boolean;
  size: string;
}

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function parseArray<T>(value: unknown): T[] {
  if (!value) return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  return Array.isArray(parsed) ? parsed as T[] : [];
}

async function readConnections(): Promise<Connection[]> {
  return parseArray<Connection>(await sdk.storage.get<Connection[] | string>(CONNECTIONS_KEY));
}

async function writeConnections(connections: Connection[]): Promise<void> {
  await sdk.storage.set(CONNECTIONS_KEY, connections);
}

async function readSessions(): Promise<SessionInfo[]> {
  return parseArray<SessionInfo>(await sdk.storage.get<SessionInfo[] | string>(SESSIONS_KEY));
}

async function writeSessions(sessions: SessionInfo[]): Promise<void> {
  await sdk.storage.set(SESSIONS_KEY, sessions);
}

function normalizeConnection(params: Record<string, unknown>, existing?: Connection): Connection {
  const timestampId = existing?.id ?? createId('connection');
  return {
    id: timestampId,
    name: String(params.name ?? existing?.name ?? ''),
    host: String(params.host ?? existing?.host ?? ''),
    port: Number(params.port ?? existing?.port ?? 22),
    username: String(params.username ?? existing?.username ?? ''),
    auth_type: (params.auth_type ?? existing?.auth_type ?? 'key_file') as Connection['auth_type'],
    key_path: params.key_path === undefined ? existing?.key_path : String(params.key_path ?? ''),
  };
}

async function addConnection(params: Record<string, unknown>): Promise<Connection> {
  const connections = await readConnections();
  const connection = normalizeConnection(params);
  connections.push(connection);
  await writeConnections(connections);
  await sdk.telemetry.track({ name: 'remote-cli.connection.added', timestamp: new Date().toISOString() });
  return connection;
}

async function updateConnection(params: Record<string, unknown>): Promise<Connection> {
  const id = String(params.id ?? '');
  const connections = await readConnections();
  const index = connections.findIndex((connection) => connection.id === id);
  if (index < 0) throw new Error(`Connection not found: ${id}`);
  const connection = normalizeConnection(params, connections[index]);
  connections[index] = connection;
  await writeConnections(connections);
  return connection;
}

async function removeConnection(id: string): Promise<void> {
  await writeConnections((await readConnections()).filter((connection) => connection.id !== id));
  await writeSessions((await readSessions()).filter((session) => session.connection_id !== id));
}

async function createSession(params: Record<string, unknown>): Promise<SessionInfo> {
  const connectionId = String(params.connection_id ?? '');
  const connection = (await readConnections()).find((item) => item.id === connectionId);
  if (!connection) throw new Error(`Connection not found: ${connectionId}`);
  const session: SessionInfo = {
    id: createId('session'),
    connection_id: connection.id,
    connection_name: connection.name,
    created_at: new Date().toISOString(),
  };
  const sessions = await readSessions();
  sessions.push(session);
  await writeSessions(sessions);
  await sdk.tasks.start({ taskType: 'remote-cli.session.open', input: { connectionId }, stream: false });
  return session;
}

async function agentChat(params: Record<string, unknown>): Promise<AgentResponse> {
  const message = String(params.message ?? '');
  if (!message) throw new Error('message is required');
  const result = await sdk.agent.stream({
    agentSessionId: String(params.session_id ?? ''),
    message,
    metadata: { history: params.history ?? [] },
  }, () => {});
  return { text: result.content, commands: [] };
}

async function runAction<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  switch (action) {
    case 'list-connections':
      return { connections: await readConnections() } as T;
    case 'add-connection':
      return { connection: await addConnection(params) } as T;
    case 'update-connection':
      return { connection: await updateConnection(params) } as T;
    case 'remove-connection':
      await removeConnection(String(params.id ?? ''));
      return { ok: true } as T;
    case 'list-sessions':
      return { sessions: await readSessions() } as T;
    case 'create-session':
      return { session: await createSession(params) } as T;
    case 'close-session':
      await writeSessions((await readSessions()).filter((session) => session.id !== String(params.session_id ?? '')));
      return { ok: true } as T;
    case 'resize':
      await sdk.telemetry.mark({ name: 'remote-cli.terminal.resize', timestamp: new Date().toISOString() });
      return { ok: true } as T;
    case 'parse-ssh-config':
      await sdk.system.getInfo();
      return { hosts: [] as SSHConfigHost[] } as T;
    case 'list-ssh-keys':
      await sdk.system.getInfo();
      return { keys: [] as SSHKeyFile[] } as T;
    case 'test-connection': {
      const id = String(params.id ?? '');
      const exists = (await readConnections()).some((connection) => connection.id === id);
      return { ok: exists, error: exists ? undefined : `Connection not found: ${id}` } as T;
    }
    case 'agent-chat':
      return await agentChat(params) as T;
    default:
      throw new Error(`Unsupported remote-cli action: ${action}`);
  }
}

export const api = {
  appletAction: runAction,
};
