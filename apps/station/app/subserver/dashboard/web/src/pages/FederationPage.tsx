import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Spin, Tag, Typography } from 'antd';
import { Plus, RefreshCw } from 'lucide-react';
import { federation, type Federation, type MemberStation } from '../api/federation';
import { aiError } from '../api/ai';
import { getAuthEpoch } from '../api/client';
import { t } from '../i18n';
import PageHeader from '../components/PageHeader';

export default function FederationPage() {
  const [items, setItems] = useState<Federation[]>([]);
  const [members, setMembers] = useState<Record<string, MemberStation[]>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'create' | 'join' | null>(null);
  const [form] = Form.useForm();
  const request = useRef(0);
  const mounted = useRef(true);
  const refresh = async () => {
    const id = ++request.current;
    const epoch = getAuthEpoch();
    setLoading(true); setError('');
    try {
      const result = await federation.list();
      if (!mounted.current || epoch !== getAuthEpoch() || request.current !== id) return;
      const nextItems = result.federations || [];
      const rows = await Promise.all(nextItems.map(async (item) =>
        [item.federation_id, (await federation.stations(item.federation_id)).stations || []] as const));
      if (!mounted.current || epoch !== getAuthEpoch() || request.current !== id) return;
      setItems(nextItems); setMembers(Object.fromEntries(rows));
    } catch (e) {
      if (mounted.current && epoch === getAuthEpoch() && request.current === id) setError(aiError(e));
    } finally {
      if (mounted.current && epoch === getAuthEpoch() && request.current === id) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true; void refresh();
    return () => { mounted.current = false; request.current++; };
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    const epoch = getAuthEpoch();
    setBusy(true); setError('');
    try {
      await action();
      if (!mounted.current || epoch !== getAuthEpoch()) return;
      setModal(null); form.resetFields(); await refresh();
    } catch (e) {
      if (mounted.current && epoch === getAuthEpoch()) setError(aiError(e));
    } finally { if (mounted.current && epoch === getAuthEpoch()) setBusy(false); }
  };
  const submit = async () => {
    const epoch = getAuthEpoch();
    const values = await form.validateFields().catch(() => null);
    if (!values || !mounted.current || epoch !== getAuthEpoch()) return;
    await run(() => modal === 'create'
      ? federation.create(values.name, values.description || '')
      : federation.join(values.federation_id, values.federation_endpoint));
  };
  return (
    <div className="ai-page">
      <PageHeader title={t('federation.title')} subtitle={t('federation.subtitle')} />
      <div className="ai-actions">
        <Button loading={loading} icon={<RefreshCw size={14} />} onClick={() => void refresh()}>{t('refresh')}</Button>
        <Button icon={<Plus size={14} />} disabled={busy} onClick={() => { form.resetFields(); setModal('create'); }}>{t('federation.create')}</Button>
        <Button disabled={busy} onClick={() => { form.resetFields(); setModal('join'); }}>{t('federation.join')}</Button>
      </div>
      {error && <Alert type="error" showIcon title={error} />}
      {loading && !items.length ? <Spin /> : !items.length && <Typography.Paragraph type="secondary">{t('federation.empty')}</Typography.Paragraph>}
      {items.map((item) => (
        <section key={item.federation_id} className="ai-editor-section" data-federation-id={item.federation_id}>
          <div className="ai-section-heading">
            <Typography.Title level={4}>{item.name}</Typography.Title>
            <Tag color={item.status === 'active' ? 'success' : 'default'}>{item.status}</Tag>
          </div>
          <Typography.Paragraph type="secondary">{item.description || item.federation_id}</Typography.Paragraph>
          <Typography.Paragraph type="secondary">{t('federation.ledger', { sequence: item.head_seq, count: item.member_station_count })}</Typography.Paragraph>
          {(members[item.federation_id] || []).map((station) => (
            <div key={station.station_peer_id} className="ai-model-row">
              <div className="ai-model-label"><Typography.Text strong>{station.station_name || station.station_peer_id}</Typography.Text>
                <Typography.Text type="secondary">{station.station_url}</Typography.Text></div>
              <Tag>{station.status}</Tag>
            </div>
          ))}
          <div className="ai-actions">
            {item.capability?.can_leave && item.status === 'active' && (
              <Popconfirm title={t('federation.leaveConfirm')} description={t('federation.leaveHint')}
                onConfirm={() => run(() => federation.leave(item.federation_id))}>
                <Button danger disabled={busy}>{t('federation.leave')}</Button>
              </Popconfirm>
            )}
            {item.capability?.can_archive && item.status === 'active' && (
              <Popconfirm title={t('federation.deleteConfirm')} description={t('federation.deleteHint')}
                onConfirm={() => run(() => federation.remove(item.federation_id))}>
                <Button danger disabled={busy}>{t('federation.delete')}</Button>
              </Popconfirm>
            )}
          </div>
        </section>
      ))}
      <Modal title={t(modal === 'create' ? 'federation.create' : 'federation.join')} open={!!modal} confirmLoading={busy}
        onCancel={() => setModal(null)} onOk={() => void submit()}>
        <Form form={form} layout="vertical">
          {modal === 'create' ? <>
            <Form.Item name="name" label={t('name')} rules={[{ required: true }, { max: 255 }]}><Input /></Form.Item>
            <Form.Item name="description" label={t('description')}><Input.TextArea /></Form.Item>
          </> : <>
            <Form.Item name="federation_id" label={t('federation.id')} rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="federation_endpoint" label={t('federation.endpoint')} rules={[{ required: true }, { type: 'url' }]}><Input /></Form.Item>
          </>}
        </Form>
        {error && <Alert type="error" title={error} />}
      </Modal>
    </div>
  );
}
