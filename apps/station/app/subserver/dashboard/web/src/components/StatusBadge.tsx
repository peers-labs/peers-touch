/**
 * Status badge component for displaying entity states.
 * Maps known status strings to appropriate antd Tag colors.
 *
 * Created: 2026-04-10
 */

import { Tag } from 'antd';

/** Color and display text mapping for known status values. */
const STATUS_MAP: Record<string, { color: string; text: string }> = {
  online:   { color: 'green',   text: 'Online' },
  offline:  { color: 'default', text: 'Offline' },
  away:     { color: 'orange',  text: 'Away' },
  running:  { color: 'green',   text: 'Running' },
  stopped:  { color: 'red',     text: 'Stopped' },
  starting: { color: 'blue',    text: 'Starting' },
  error:    { color: 'red',     text: 'Error' },
  active:   { color: 'green',   text: 'Active' },
  revoked:  { color: 'red',     text: 'Revoked' },
  expired:  { color: 'default', text: 'Expired' },
  disabled: { color: 'red',     text: 'Disabled' },
  enabled:  { color: 'green',   text: 'Enabled' },
};

interface Props {
  status: string;
}

export default function StatusBadge({ status }: Props) {
  const mapped = STATUS_MAP[status.toLowerCase()] || {
    color: 'default',
    text: status,
  };

  return <Tag color={mapped.color}>{mapped.text}</Tag>;
}
