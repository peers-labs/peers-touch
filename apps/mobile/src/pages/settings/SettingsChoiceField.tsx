import { useState } from 'react';
import { Button, Modal, Typography } from 'antd';
import { Check, ChevronDown } from 'lucide-react';
import { BoundedList } from '../../components/BoundedList';
import { useMobileI18n } from '../../app/mobileI18n';
import './agent-settings.css';

/** Mobile choices share a full-width sheet and a 44px trigger. */
export function SettingsChoiceField<Value extends string>({
  label, value, options, disabled = false, onChange, field,
}: {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly disabled?: boolean;
  readonly onChange: (value: Value) => void;
  readonly field: string;
}) {
  const { t } = useMobileI18n();
  const [open, setOpen] = useState(false);
  return <>
    <div className="settings-row">
      <Typography.Text>{label}</Typography.Text>
      <Button className="settings-choice-trigger" data-setting-field={field} aria-label={label}
        disabled={disabled || options.length === 0} icon={<ChevronDown size={16} />}
        onClick={() => setOpen(true)}>
        {options.find((option) => option.value === value)?.label ?? (value || t('mobile.settings.general.notConfigured'))}
      </Button>
    </div>
    <Modal open={open} title={label} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
      <BoundedList surfaceKey={`settings:choice:${field}`} items={options} itemKey={(option) => option.value} size={40}>
        {(items) => items.map((option) => <button type="button" key={option.value}
          className="setting-row settings-choice-option" data-setting-option={option.value}
          aria-pressed={option.value === value} onClick={() => { onChange(option.value); setOpen(false); }}>
          <Typography.Text>{option.label}</Typography.Text>
          {option.value === value ? <Check size={18} aria-hidden="true" /> : null}
        </button>)}
      </BoundedList>
    </Modal>
  </>;
}
