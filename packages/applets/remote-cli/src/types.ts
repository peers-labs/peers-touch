export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: 'password' | 'key' | 'key_file' | 'agent';
  key_path?: string;
}

export interface SessionInfo {
  id: string;
  connection_id: string;
  connection_name: string;
  created_at: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  commands?: string[];
  timestamp: number;
}

export interface AgentResponse {
  text: string;
  commands?: string[];
}
