/**
 * AccessGatesPage — Station access-gate administration.
 *
 * The Station owns its admission policy; this page is the only place that
 * mutates it. Two concerns are exposed:
 *   - Policy: admission mode, the ordered gate chain that runs per attempt,
 *     self-service invite toggle, and the administrator-managed allowlists.
 *   - Invite codes: mint / list / revoke Station-issued redemption codes that
 *     let a holder pass the invite.code gate.
 *
 * Disabling a gate type here removes that gate flow from every client (Desktop
 * and Mobile) without a client release — the Station stops emitting it.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, Switch, Space,
  Typography, message, Popconfirm, Tabs, Tag, DatePicker,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import { ShieldCheck, Ticket, Plus, Save } from 'lucide-react';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader';
import * as accessApi from '../api/accessGates';
import { ACCESS_GATE_TYPE, ACCESS_POLICY_MODE } from '../api/accessGates';
import { formatTime } from '../utils/format';
import { log } from '../utils/logger';

const { Text, Paragraph } = Typography;

// Human-readable labels for the admission modes.
const MODE_OPTIONS = [
  { value: ACCESS_POLICY_MODE.OPEN, label: 'Open — anyone who logs in may enter' },
  { value: ACCESS_POLICY_MODE.INVITE_ONLY, label: 'Invite only — allowlist or invite code required' },
  { value: ACCESS_POLICY_MODE.FIXED_USERS, label: 'Fixed users — only listed actors may enter' },
  { value: ACCESS_POLICY_MODE.CLOSED, label: 'Closed — admission disabled' },
];

// Only gate types backed by a registered Station gatekeeper are configurable.
const GATE_OPTIONS = [
  { value: ACCESS_GATE_TYPE.STATION_CAPABILITY, label: 'Station capability' },
  { value: ACCESS_GATE_TYPE.AUTH_LOGIN, label: 'Login' },
  { value: ACCESS_GATE_TYPE.INVITE_ALLOWLIST, label: 'Invite allowlist' },
  { value: ACCESS_GATE_TYPE.INVITE_CODE, label: 'Invite code' },
];

/** Convert a newline/comma separated textarea value into a trimmed list. */
function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function AccessGatesPage() {
  // ── Policy state ────────────────────────────────────────────────────
  const [policyForm] = Form.useForm();
  const [savingPolicy, setSavingPolicy] = useState(false);

  // ── Invite-code state ───────────────────────────────────────────────
  const [codes, setCodes] = useState<accessApi.InviteCode[]>([]);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();

  // ── Loaders ─────────────────────────────────────────────────────────

  const loadPolicy = useCallback(async () => {
    try {
      const policy = await accessApi.getAccessPolicy();
      policyForm.setFieldsValue({
        mode: policy.mode || ACCESS_POLICY_MODE.OPEN,
        self_service_invite: policy.self_service_invite ?? false,
        enabled_gates: policy.enabled_gates ?? [],
        allowed_emails: (policy.allowed_emails ?? []).join('\n'),
        allowed_usernames: (policy.allowed_usernames ?? []).join('\n'),
        allowed_actor_ptids: (policy.allowed_actor_ptids ?? []).join('\n'),
      });
    } catch (err) {
      log.error('access-gates', 'Failed to load access policy');
      message.error('Failed to load access policy');
    }
  }, [policyForm]);

  const loadCodes = useCallback(async () => {
    try {
      const items = await accessApi.listInviteCodes(includeRevoked);
      setCodes(items || []);
    } catch (err) {
      log.error('access-gates', 'Failed to load invite codes');
      message.error('Failed to load invite codes');
    }
  }, [includeRevoked]);

  useEffect(() => { loadPolicy(); }, [loadPolicy]);
  useEffect(() => { loadCodes(); }, [loadCodes]);

  // ── Policy save ─────────────────────────────────────────────────────

  const handleSavePolicy = async () => {
    const values = await policyForm.validateFields();
    setSavingPolicy(true);
    try {
      await accessApi.updateAccessPolicy({
        mode: values.mode,
        self_service_invite: values.self_service_invite,
        enabled_gates: values.enabled_gates ?? [],
        allowed_emails: parseList(values.allowed_emails || ''),
        allowed_usernames: parseList(values.allowed_usernames || ''),
        allowed_actor_ptids: parseList(values.allowed_actor_ptids || ''),
      });
      message.success('Access policy updated');
      loadPolicy();
    } catch (err) {
      message.error('Failed to update access policy');
    } finally {
      setSavingPolicy(false);
    }
  };

  // ── Invite-code actions ─────────────────────────────────────────────

  const handleCreateCode = async (values: {
    code?: string; note?: string; max_uses?: number; expires_at?: dayjs.Dayjs;
  }) => {
    try {
      await accessApi.createInviteCode({
        code: values.code?.trim() || undefined,
        note: values.note?.trim() || undefined,
        max_uses: values.max_uses ?? 0,
        expires_at: values.expires_at ? values.expires_at.toISOString() : undefined,
      });
      message.success('Invite code created');
      setCreateOpen(false);
      createForm.resetFields();
      loadCodes();
    } catch (err) {
      message.error('Failed to create invite code');
    }
  };

  const handleRevokeCode = async (id: string) => {
    try {
      await accessApi.revokeInviteCode(id);
      message.success('Invite code revoked');
      loadCodes();
    } catch (err) {
      message.error('Failed to revoke invite code');
    }
  };

  // ── Columns ─────────────────────────────────────────────────────────

  const codeColumns: ColumnsType<accessApi.InviteCode> = [
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      render: (v: string) => <Text code copyable>{v}</Text>,
    },
    { title: 'Note', dataIndex: 'note', key: 'note', ellipsis: true },
    {
      title: 'Usage',
      key: 'usage',
      render: (_, r) => {
        const max = r.max_uses ?? 0;
        return <Text>{r.used_count ?? 0} / {max > 0 ? max : '∞'}</Text>;
      },
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, r) => {
        if (r.revoked) return <Tag color="red">Revoked</Tag>;
        if (r.expires_at && dayjs(r.expires_at).isBefore(dayjs())) {
          return <Tag color="orange">Expired</Tag>;
        }
        const max = r.max_uses ?? 0;
        if (max > 0 && (r.used_count ?? 0) >= max) {
          return <Tag color="orange">Exhausted</Tag>;
        }
        return <Tag color="green">Active</Tag>;
      },
    },
    {
      title: 'Expires',
      dataIndex: 'expires_at',
      key: 'expires',
      render: (v: string) => (v ? formatTime(v) : <Text type="secondary">Never</Text>),
    },
    {
      title: 'Created By',
      dataIndex: 'created_by',
      key: 'created_by',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_, r) =>
        r.revoked ? (
          <Text type="secondary">—</Text>
        ) : (
          <Popconfirm
            title="Revoke this invite code?"
            description="Holders will no longer be able to redeem it."
            onConfirm={() => handleRevokeCode(r.id)}
          >
            <Button type="link" size="small" danger>Revoke</Button>
          </Popconfirm>
        ),
    },
  ];

  // ── Tabs ────────────────────────────────────────────────────────────

  const policyTab = (
    <Form form={policyForm} layout="vertical" style={{ maxWidth: 560 }}>
      <Form.Item
        name="mode"
        label="Admission mode"
        rules={[{ required: true }]}
      >
        <Select options={MODE_OPTIONS} />
      </Form.Item>

      <Form.Item
        name="enabled_gates"
        label="Gate chain"
        tooltip="The ordered set of gates the Station evaluates per attempt. Empty means the built-in default chain. Removing a gate disables it on every client."
      >
        <Select mode="multiple" options={GATE_OPTIONS} placeholder="Built-in default chain" />
      </Form.Item>

      <Form.Item
        name="self_service_invite"
        label="Self-service invite redemption"
        valuePropName="checked"
        tooltip="When on, the Station offers the invite.code gate so visitors can redeem a code themselves."
      >
        <Switch />
      </Form.Item>

      <Form.Item
        name="allowed_emails"
        label="Allowed emails"
        tooltip="One per line. Used by the invite allowlist gate."
      >
        <Input.TextArea rows={3} placeholder="alice@example.com" />
      </Form.Item>

      <Form.Item name="allowed_usernames" label="Allowed usernames" tooltip="One per line.">
        <Input.TextArea rows={3} placeholder="alice" />
      </Form.Item>

      <Form.Item name="allowed_actor_ptids" label="Allowed actor PTIDs" tooltip="One PTID per line.">
        <Input.TextArea rows={3} placeholder="p1..." />
      </Form.Item>

      <Button type="primary" icon={<Save size={14} />} loading={savingPolicy} onClick={handleSavePolicy}>
        Save policy
      </Button>
    </Form>
  );

  const codesTab = (
    <Flexbox gap={16}>
      <Flexbox horizontal justify="space-between" align="center">
        <Space>
          <Switch checked={includeRevoked} onChange={setIncludeRevoked} size="small" />
          <Text type="secondary">Show revoked</Text>
        </Space>
        <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
          New invite code
        </Button>
      </Flexbox>

      <Table
        dataSource={codes}
        columns={codeColumns}
        rowKey="id"
        size="small"
        pagination={false}
      />
    </Flexbox>
  );

  const tabItems = [
    {
      key: 'policy',
      label: (
        <span>
          <ShieldCheck size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Policy
        </span>
      ),
      children: policyTab,
    },
    {
      key: 'codes',
      label: (
        <span>
          <Ticket size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Invite Codes
        </span>
      ),
      children: codesTab,
    },
  ];

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <Flexbox gap={0}>
      <PageHeader title="Access Gates" subtitle="Station admission policy and invite codes" />

      <Flexbox style={{ padding: 24 }}>
        <Paragraph type="secondary" style={{ maxWidth: 720 }}>
          The Station owns its admission policy. Clients only execute the gate chain
          the Station emits, so changes here apply to Desktop and Mobile immediately.
        </Paragraph>
        <Tabs items={tabItems} />
      </Flexbox>

      <Modal
        title="Create Invite Code"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreateCode}>
          <Form.Item
            name="code"
            label="Code"
            tooltip="Leave empty to let the Station generate a random code."
          >
            <Input placeholder="Auto-generated when empty" />
          </Form.Item>

          <Form.Item name="note" label="Note">
            <Input placeholder="Optional reminder of who this is for" />
          </Form.Item>

          <Form.Item
            name="max_uses"
            label="Max uses"
            tooltip="Zero means unlimited redemptions."
          >
            <InputNumber min={0} style={{ width: '100%' }} placeholder="0 (unlimited)" />
          </Form.Item>

          <Form.Item name="expires_at" label="Expires at" tooltip="Leave empty for no expiry.">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Flexbox>
  );
}
