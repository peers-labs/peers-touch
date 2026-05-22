// NetworkCapability — delegates network operations to the bridge adapter.

import type { BridgeAdapter } from '../adapter.js';

export interface NetworkRequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

export interface NetworkResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface NetworkAPI {
  request(options: NetworkRequestOptions): Promise<NetworkResponse>;
}

export function createNetworkAPI(adapter: BridgeAdapter): NetworkAPI {
  return {
    request(options: NetworkRequestOptions): Promise<NetworkResponse> {
      return adapter.invoke('network.request', options as unknown as Record<string, unknown>) as Promise<NetworkResponse>;
    },
  };
}
