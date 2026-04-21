/**
 * Storage API — database driver, connection pool, and per-table row counts.
 * All numbers are sourced from the live *gorm.DB / *sql.DB on the station.
 */

import client from './client';

export interface StoragePoolStats {
  max_open_connections: number;
  open_connections: number;
  in_use: number;
  idle: number;
  wait_count: number;
  wait_duration_ms: number;
  max_idle_closed: number;
  max_idle_time_closed: number;
  max_lifetime_closed: number;
}

export interface StorageTableCount {
  group: string;
  table: string;
  rows: number;
  error?: string;
}

export interface StorageInfo {
  driver: string;
  pool?: StoragePoolStats;
  tables: StorageTableCount[];
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const { data } = await client.get<StorageInfo>('/storage/info');
  return data;
}
