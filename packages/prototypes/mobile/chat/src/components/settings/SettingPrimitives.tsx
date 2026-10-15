import type { ReactNode } from 'react';
import { Select, Typography } from 'antd';

const { Text } = Typography;

export function Capability({
  id,
  disposition = 'supported',
  reason,
  className = '',
  children,
}: {
  id: string;
  disposition?: 'supported' | 'adapted' | 'degraded';
  reason?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`mp-capability ${className}`}
      data-capability-id={id}
      data-capability-disposition={disposition}
    >
      {children}
      {reason && <div className="mp-capability-reason">{reason}</div>}
    </div>
  );
}

export function SettingSection({
  title,
  description,
  action,
  className = '',
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`mp-setting-section ${className}`}>
      <div className="mp-setting-section-heading">
        <span className="mp-setting-section-copy">
          <Text strong>{title}</Text>
          {description && <Text type="secondary">{description}</Text>}
        </span>
        {action && <span className="mp-setting-section-actions">{action}</span>}
      </div>
      <div className="mp-setting-detail-card">{children}</div>
    </section>
  );
}

export function SettingRow({
  label,
  description,
  capability,
  disposition,
  children,
}: {
  label: string;
  description?: string;
  capability?: string;
  disposition?: 'supported' | 'adapted' | 'degraded';
  children?: ReactNode;
}) {
  const row = (
    <div className="mp-setting-detail-row">
      <span className="mp-setting-row-copy">
        <span className="mp-setting-detail-label">{label}</span>
        {description && <span className="mp-setting-row-description">{description}</span>}
      </span>
      {children}
    </div>
  );
  return capability ? (
    <Capability id={capability} disposition={disposition}>{row}</Capability>
  ) : row;
}

export function SettingActionRow({
  label,
  icon,
  capability,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  capability: string;
  onClick: () => void;
}) {
  return (
    <Capability id={capability}>
      <button
        type="button"
        className="mp-setting-detail-row mp-setting-action-row"
        data-capability-action={capability}
        onClick={onClick}
      >
        <span className="mp-setting-detail-label">{label}</span>
        {icon}
      </button>
    </Capability>
  );
}

export function SettingToggle({
  label,
  checked,
  onChange,
  capability,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  capability?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`mp-toggle ${checked ? 'active' : ''}`}
      aria-label={label}
      aria-pressed={checked}
      data-capability-action={capability}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Choice({
  value,
  onChange,
  options,
  label,
  capability,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  label: string;
  capability?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      aria-label={label}
      data-capability-action={capability}
      disabled={disabled}
      value={value}
      options={options}
      onChange={onChange}
      popupMatchSelectWidth={false}
    />
  );
}

export function SettingList({
  rows,
}: {
  rows: Array<{
    id?: string;
    title: string;
    detail: string;
    value?: string;
    status?: 'ready' | 'warning' | 'error';
    action?: ReactNode;
  }>;
}) {
  return (
    <div className="mp-setting-list" data-ui-rows>
      {rows.map((row) => (
        <div key={row.id ?? row.title} className="mp-setting-list-item" data-ui-row>
          <span className={`mp-setting-status ${row.status ?? 'ready'}`} aria-hidden="true" />
          <span className="mp-setting-list-copy" data-ui-column="content" data-ui-column-align="start">
            <Text strong>{row.title}</Text>
            <Text type="secondary">{row.detail}</Text>
          </span>
          {row.action ?? (row.value && (
            <Text type="secondary" className="mp-setting-list-value" data-ui-column="meta" data-ui-column-align="end">
              {row.value}
            </Text>
          ))}
        </div>
      ))}
    </div>
  );
}

export function DegradedCapability({
  id,
  title,
  reason,
}: {
  id: string;
  title: string;
  reason: string;
}) {
  return (
    <Capability id={id} disposition="degraded" reason={reason}>
      <div className="mp-setting-detail-row mp-setting-disabled">
        <span className="mp-setting-row-copy">
          <span className="mp-setting-detail-label">{title}</span>
          <span className="mp-setting-row-description">Unavailable on this device</span>
        </span>
        <span className="mp-setting-list-value">Desktop only</span>
      </div>
    </Capability>
  );
}

export function InlineStatus({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  children: ReactNode;
}) {
  return (
    <div
      className={`mp-setting-inline-status ${tone}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
