/**
 * Shared helpers for the OSS dashboard tabs.
 *
 * Lives outside the per-tab files so the time-display and string-
 * truncation conventions stay consistent across Workers / Federation
 * / Buckets / Objects / Audit / Usage. If you need to touch the way
 * a timestamp or a hash is rendered, change it here once.
 */

import type { CSSProperties, ReactNode } from 'react';
import { Tag } from 'antd';
import { Globe, Lock, MessageSquare } from 'lucide-react';
import { formatRelativeTime, formatTime } from '../../utils/format';

/**
 * Detects the Go zero-time sentinel (`0001-01-01T…`) the JSON
 * encoder emits for unset `time.Time` fields. We render those as
 * "never" so the operator does not see a 1-AD timestamp.
 */
export function isZeroTime(ts: string | null | undefined): boolean {
  if (!ts) return true;
  return ts.startsWith('0001-01-01');
}

export function formatRelative(ts: string | null | undefined): string {
  if (isZeroTime(ts)) return 'never';
  return formatRelativeTime(ts!);
}

export function formatAbsolute(ts: string | null | undefined): string {
  if (isZeroTime(ts)) return '—';
  return formatTime(ts!);
}

/** Truncate a long opaque string (KID / PEM / SHA256) to a fingerprint. */
export function shortHash(s: string, head = 10, tail = 6): string {
  if (!s) return '';
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/**
 * Formats a byte count using binary (1024-based) units.
 *
 * We use binary units everywhere on the OSS surface so that the
 * "Used" column on a bucket lines up with the per-file `size` and
 * with what the underlying filesystem reports.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/**
 * Human-friendly OSS visibility chip. Used by the Objects tab and
 * the Buckets default-visibility column. The chat-attachment chip
 * in the desktop client uses similar colours so an operator
 * watching both surfaces can transfer intuition.
 */
export function VisibilityChip({ value }: { value: string }) {
  const v = (value || '').toLowerCase();
  let icon: ReactNode = null;
  let color = 'default';
  let label = v || '—';
  switch (v) {
    case 'public':
      icon = <Globe size={12} />;
      color = 'blue';
      break;
    case 'chat':
      icon = <MessageSquare size={12} />;
      color = 'cyan';
      break;
    case 'private':
      icon = <Lock size={12} />;
      color = 'default';
      break;
    default:
      label = value || '—';
  }
  const style: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4 };
  return (
    <Tag color={color} icon={icon as any} style={style}>
      {label}
    </Tag>
  );
}
