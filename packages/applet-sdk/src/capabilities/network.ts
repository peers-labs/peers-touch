// NetworkCapability — delegates network operations to the bridge adapter.

import type { BridgeAdapter } from '../adapter.js';

export interface NetworkRequestOptions {
  service: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  stream?: boolean;
}

export interface NetworkResponse<TBody = unknown> {
  status: number;
  headers: Record<string, string>;
  body: TBody;
}

export interface NetworkUploadOptions {
  service: string;
  path: string;
  filePath?: string;
  fileName?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface NetworkUploadResult<TBody = unknown> {
  status: number;
  headers: Record<string, string>;
  body: TBody;
}

export interface NetworkDownloadOptions {
  service: string;
  path: string;
  filePath?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface NetworkDownloadResult<TBody = unknown> {
  status: number;
  headers: Record<string, string>;
  body?: TBody;
  file?: {
    path: string;
    sizeBytes: number;
  };
}

export interface NetworkAPI {
  request<TBody = unknown>(options: NetworkRequestOptions): Promise<NetworkResponse<TBody>>;
  upload<TBody = unknown>(options: NetworkUploadOptions): Promise<NetworkUploadResult<TBody>>;
  download<TBody = unknown>(options: NetworkDownloadOptions): Promise<NetworkDownloadResult<TBody>>;
}

export function createNetworkAPI(adapter: BridgeAdapter): NetworkAPI {
  return {
    request<TBody = unknown>(options: NetworkRequestOptions): Promise<NetworkResponse<TBody>> {
      return adapter.invoke('network.request', options as unknown as Record<string, unknown>) as Promise<NetworkResponse<TBody>>;
    },
    upload<TBody = unknown>(options: NetworkUploadOptions): Promise<NetworkUploadResult<TBody>> {
      return adapter.invoke('network.upload', options as unknown as Record<string, unknown>) as Promise<NetworkUploadResult<TBody>>;
    },
    download<TBody = unknown>(options: NetworkDownloadOptions): Promise<NetworkDownloadResult<TBody>> {
      return adapter.invoke('network.download', options as unknown as Record<string, unknown>) as Promise<NetworkDownloadResult<TBody>>;
    },
  };
}
