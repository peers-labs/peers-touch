import { useState } from 'react';
import { Alert, Button, Collapse, Form, Input, InputNumber, Modal, Select, Space } from 'antd';
import { addWireProfile, defaultWireProfile, removeWireProfile, saveWireProfile, type WireGraph, type WireService } from './modelServiceWireflow';

export default function CLIProfileWireEditor({ item, graph, onSelect }: { item: WireService; graph: WireGraph; onSelect: (id: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(item.generation);
  const [form] = Form.useForm();
  const sourceID = Form.useWatch('backendId', form) ?? item.backendId ?? '';
  const sources = graph.services.filter((entry) => entry.owner === item.owner && entry.kind === 'api');
  const source = sources.find((entry) => entry.id === sourceID);
  const profiles = graph.services.filter((entry) => entry.kind === 'cli' && entry.vendor === item.vendor && entry.owner === item.owner);
  const values = () => ({ name: item.label, backendId: item.backendId || '',
    model: item.runtime?.model || '', prompt: item.runtime?.prompt || '', args: item.runtime?.args || '',
    environment: item.runtime?.environment || '', timeout: item.runtime?.timeout || 120 });
  return <div style={{ paddingBottom: 16 }}>
    <Space wrap style={{ marginBottom: 16 }}>
      <Select virtual={false} aria-label="CLI 配置档案" style={{ minWidth: 200 }} value={item.id} onChange={onSelect}
        options={profiles.map((profile) => ({ value: profile.id, label: profile.label }))} />
      <Button onClick={() => setCreating(true)}>新建配置</Button>
      <Button disabled={graph.profileDefaults[item.vendor] === item.id}
        onClick={() => defaultWireProfile(item.vendor, item.id)}>
        {graph.profileDefaults[item.vendor] === item.id ? '默认配置' : '设为默认'}
      </Button>
      {item.id !== item.vendor && <Button danger onClick={() => Modal.confirm({
        title: '删除配置？', content: '历史对话和个人默认保留；后续调用不会切换到其他配置。',
        onOk: () => { removeWireProfile(item.id); onSelect(item.vendor); },
      })}>删除配置</Button>}
    </Space>
    {error && <Alert title={error} type="warning" action={<Button onClick={() => {
      form.setFieldsValue(values()); setRevision(item.generation); setError('');
    }}>放弃草稿并载入</Button>} />}
    <Form form={form} layout="vertical" initialValues={values()} onFinish={(draft) => {
      if (!saveWireProfile(item.id, draft.name, draft.backendId, draft, revision)) setError('配置已变更，草稿已保留。');
      else { setRevision(revision + 1); setError(''); }
    }}>
      <Form.Item name="name" label="配置名称" rules={[{ required: true }]}><Input /></Form.Item>
      {item.vendor === 'codex' && <Form.Item name="backendId" label="模型连接" extra="Codex 需要 OpenAI Responses；用户需同时拥有来源连接与配置档案权限。">
        <Select virtual={false} onChange={() => form.setFieldValue('model', '')} options={[
          { value: '', label: '供应商账号 / API 密钥' },
          ...sources.map((entry) => ({ value: entry.id, label: entry.label })),
        ]} />
      </Form.Item>}
      <Form.Item name="model" label="默认模型" rules={sourceID ? [{ required: true }] : []}>
        <Select virtual={false} options={(source?.models || item.models).map((entry) => ({ value: entry.id, label: entry.label }))} />
      </Form.Item>
      <Collapse ghost items={[{ key: 'advanced', label: '高级配置', forceRender: true, children: <>
        <Form.Item name="prompt" label="全局提示词"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="args" label="启动参数" extra="每行一个参数，无需 shell 引号"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="environment" label="环境变量" extra="每行 KEY=VALUE；不可输入凭据"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="timeout" label="超时秒数"><InputNumber min={10} max={3600} /></Form.Item>
      </> }]} />
      <Button htmlType="submit" type="primary" disabled={graph.offline}>保存配置</Button>
    </Form>
    <Modal title="新建 CLI 配置" open={creating} onCancel={() => setCreating(false)} okButtonProps={{ disabled: !name.trim() }}
      onOk={() => { const id = addWireProfile(item.vendor, name.trim()); setCreating(false); onSelect(id); }}>
      <label>配置名称<Input value={name} onChange={(event) => setName(event.target.value)} /></label>
    </Modal>
  </div>;
}
