/**
 * Formatting utilities for dates, bytes, and numbers.
 */

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

/** Format a date into a full timestamp string. */
export function formatTime(date: string | Date): string {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
}

/** Format a date into a human-readable relative time (e.g. "3 minutes ago"). */
export function formatRelativeTime(date: string | Date): string {
  return dayjs(date).fromNow();
}

/** Format a byte count into a human-readable string with appropriate unit. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/** Format a large number into a compact representation (e.g. 1.2K, 3.4M). */
export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}
