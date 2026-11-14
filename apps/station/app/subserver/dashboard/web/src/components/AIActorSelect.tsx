import { useEffect, useRef, useState } from 'react';
import { Select, Typography } from 'antd';
import { listActors } from '../api/actors';
import { getAuthEpoch } from '../api/client';
import { t } from '../i18n';

/** Reuses Dashboard's actor directory; values are canonical actor PTIDs. */
export default function AIActorSelect({ value, onChange, multiple = false, label, disabled = false }: {
  value: string | string[]; onChange: (value: string | string[]) => void; multiple?: boolean; label: string; disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    const current = ++request.current;
    const auth = getAuthEpoch();
    setLoading(true);
    const timer = window.setTimeout(() => {
      void listActors(1, 100, search).then((result) => {
        if (current !== request.current || auth !== getAuthEpoch()) return;
        setOptions((previous) => [...new Map([...previous, ...result.items.map((actor) => ({
          value: actor.ptid, label: actor.name || actor.preferred_username || actor.ptid,
        }))].map((item) => [item.value, item])).values()]);
        setFailed(false);
      }).catch(() => {
        if (current === request.current && auth === getAuthEpoch()) setFailed(true);
      }).finally(() => {
        if (current === request.current && auth === getAuthEpoch()) setLoading(false);
      });
    }, 200);
    return () => { window.clearTimeout(timer); request.current++; };
  }, [search]);
  return (
    <div className="ai-actor-select">
      <Select aria-label={label} placeholder={t('ai.chooseUser')} mode={multiple ? 'multiple' : undefined}
        showSearch={{ filterOption: false, onSearch: setSearch }} loading={loading}
        options={options} value={value || undefined} onChange={onChange} disabled={disabled} style={{ width: '100%' }} />
      {failed && <Typography.Text type="danger">{t('ai.usersUnavailable')}</Typography.Text>}
    </div>
  );
}
