import { Button, Field, Text, TextArea, TextField } from '@peers-touch/ui';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileNotice } from '../../components/MobileNotice';

export function ContactRemarkForm(props: {
  nickname: string;
  note: string;
  saving: boolean;
  error: string;
  onNicknameChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSave: () => void | Promise<void>;
}) {
  const { t } = useMobileI18n();
  return <div className="contact-remark-form" data-product-surface="contacts.remark">
    <Field label={t('mobile.contacts.nickname')}>
      <TextField aria-label={t('mobile.contacts.nickname')} value={props.nickname}
        maxLength={100} readOnly={props.saving} onValueChange={props.onNicknameChange} />
    </Field>
    <Field label={t('mobile.contacts.localNote')}>
      <TextArea aria-label={t('mobile.contacts.localNote')} value={props.note}
        maxLength={1000} readOnly={props.saving} rows={4} onValueChange={props.onNoteChange} />
    </Field>
    <Text tone="secondary">{t('mobile.contacts.remarkLocal')}</Text>
    {props.error ? <MobileNotice tone="error">{props.error}</MobileNotice> : null}
    <Button actionId="contact-remark-save" fullWidth emphasis="primary" density="comfortable"
      execution={props.saving ? 'pending' : 'idle'} onActivate={props.onSave}>
      {t('common.action.save')}
    </Button>
  </div>;
}
