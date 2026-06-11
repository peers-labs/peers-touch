import type { BridgeAdapter } from '../adapter.js';

export interface FileEntry {
  path: string;
  kind: 'file' | 'directory';
  sizeBytes: number;
}

export interface FileReadOptions {
  path: string;
}

export interface FileReadResult {
  path: string;
  content: string;
  sizeBytes: number;
  encoding: 'utf8';
}

export interface FileWriteOptions {
  path: string;
  content: string;
}

export interface FileWriteResult {
  path: string;
  sizeBytes: number;
}

export interface FileListOptions {
  path?: string;
}

export interface FileInfo {
  quotaBytes: number;
  usedBytes: number;
  entries: FileEntry[];
}

export interface FileAPI {
  read(input: FileReadOptions): Promise<FileReadResult>;
  write(input: FileWriteOptions): Promise<FileWriteResult>;
  delete(input: FileReadOptions): Promise<void>;
  list(input?: FileListOptions): Promise<FileEntry[]>;
  getInfo(): Promise<FileInfo>;
}

export function createFileAPI(adapter: BridgeAdapter): FileAPI {
  return {
    read(input: FileReadOptions): Promise<FileReadResult> {
      return adapter.invoke('file.read', input as unknown as Record<string, unknown>) as Promise<FileReadResult>;
    },
    write(input: FileWriteOptions): Promise<FileWriteResult> {
      return adapter.invoke('file.write', input as unknown as Record<string, unknown>) as Promise<FileWriteResult>;
    },
    delete(input: FileReadOptions): Promise<void> {
      return adapter.invoke('file.delete', input as unknown as Record<string, unknown>) as Promise<void>;
    },
    list(input: FileListOptions = {}): Promise<FileEntry[]> {
      return adapter.invoke('file.list', input as unknown as Record<string, unknown>) as Promise<FileEntry[]>;
    },
    getInfo(): Promise<FileInfo> {
      return adapter.invoke('file.getInfo') as Promise<FileInfo>;
    },
  };
}
