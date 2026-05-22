// Capability method definitions for applet bridge calls.

export const CapabilityMethod = {
  StorageGet: 'storage.get',
  StorageSet: 'storage.set',
  StorageRemove: 'storage.remove',
  NetworkRequest: 'network.request',
  ConfigGet: 'config.get',
} as const;

export type CapabilityMethod = (typeof CapabilityMethod)[keyof typeof CapabilityMethod];

export interface NetworkRequestParams {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface NetworkResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface StorageParams {
  key: string;
  value?: string;
}
