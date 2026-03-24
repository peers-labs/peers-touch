import { useState, useEffect, useCallback } from 'react';
import { Modal, Form, Input, Select, InputNumber, Switch, Divider, Alert, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { KeyRound, Server, User, Lock, FileKey2 } from 'lucide-react';
import { api } from '../../services/desktop_api';
import type { Connection } from './types';

export interface ConnectDialogProps {
  open: boolean;
  onClose: () => void;
  onConnect: (connId: string, passphrase?: string) => Promise<void>;
  onSave: (conn: Partial<Connection> & { secret?: string }) => Promise<Connection>;
  connection?: Connection | null;
  mode: 'connect' | 'edit' | 'add';
}

interface SSHKeyFile {
  path: string;
  name: string;
  has_pub: boolean;
  size: string;
}

const authTypeOptions = [
  { value: 'key_file', label: 'Private Key File' },
  { value: 'password', label: 'Password' },
  { value: 'agent', label: 'SSH Agent' },
];

export function ConnectDialog({ open, onClose, onConnect, onSave, connection, mode }: ConnectDialogProps) {
  const { token } = theme.useToken();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [error, setError] = useState('');
  const [sshKeys, setSSHKeys] = useState<SSHKeyFile[]>([]);

  const authType = Form.useWatch('auth_type', form);
  const isEditing = mode === 'edit' || mode === 'add';

  const loadSSHKeys = useCallback(async () => {
    try {
      const data = await api.appletAction<{ keys: SSHKeyFile[] }>('remote-cli', 'list-ssh-keys');
      setSSHKeys(data.keys || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (open) {
      setError('');
      setNeedsPassphrase(false);
      loadSSHKeys();
      if (connection && mode !== 'add') {
        form.setFieldsValue({
          name: connection.name,
          host: connection.host,
          port: connection.port || 22,
          username: connection.username,
          auth_type: connection.auth_type || 'key_file',
          key_path: connection.key_path || '',
          save_connection: true,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ port: 22, auth_type: 'key_file', save_connection: true });
      }
    }
  }, [open, connection, mode, form, loadSSHKeys]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      setError('');

      if (mode === 'connect' && connection) {
        const isKeyAuth = connection.auth_type === 'key_file' || connection.auth_type === 'key';
        await onConnect(connection.id, isKeyAuth ? values.passphrase : undefined);
      } else {
        const connData: Partial<Connection> & { secret?: string } = {
          name: values.name || `${values.username}@${values.host}`,
          host: values.host,
          port: values.port || 22,
          username: values.username,
          auth_type: values.auth_type,
          key_path: values.key_path,
          secret: values.password,
        };
        if (mode === 'edit' && connection) {
          connData.id = connection.id;
        }
        const saved = await onSave(connData);

        if (mode === 'add' && values.connect_now) {
          const isKeyAuth = values.auth_type === 'key_file' || values.auth_type === 'key';
          await onConnect(saved.id, isKeyAuth ? values.passphrase : undefined);
        }
      }

      onClose();
    } catch (e: any) {
      const msg = e?.message || e?.errorFields?.[0]?.errors?.[0] || 'Failed';
      if (msg.includes('passphrase') || msg.includes('encrypted') || msg.includes('incorrect')) {
        setNeedsPassphrase(true);
        setError('This key requires a passphrase. Please enter it below.');
      } else {
        setError(String(msg));
      }
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'connect' ? 'Connect to Server' : mode === 'edit' ? 'Edit Connection' : 'New Connection';
  const okText = mode === 'connect' ? 'Connect' : mode === 'add' ? 'Save & Connect' : 'Save';

  const keyOptions = sshKeys.map((k) => ({
    value: k.path,
    label: (
      <Flexbox horizontal align="center" gap={6} style={{ width: '100%' }}>
        <FileKey2 size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
        <span style={{ flex: 1 }}>{k.name}</span>
        <span style={{ fontSize: 11, opacity: 0.4, fontFamily: 'monospace' }}>{k.size}</span>
        {k.has_pub && (
          <span style={{ fontSize: 10, opacity: 0.4 }}>.pub</span>
        )}
      </Flexbox>
    ),
  }));

  return (
    <Modal
      title={
        <Flexbox horizontal align="center" gap={8}>
          <Server size={18} style={{ color: token.colorPrimary }} />
          <span>{title}</span>
        </Flexbox>
      }
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={okText}
      confirmLoading={loading}
      width={520}
      destroyOnClose
    >
      {error && (
        <Alert
          type={needsPassphrase ? 'warning' : 'error'}
          message={error}
          showIcon
          closable
          onClose={() => setError('')}
          style={{ marginBottom: 16 }}
        />
      )}

      <Form form={form} layout="vertical" size="middle" requiredMark={false}>
        {isEditing && (
          <>
            <Form.Item label="Display Name" name="name">
              <Input prefix={<Server size={14} />} placeholder="e.g. Production Server" />
            </Form.Item>

            <Flexbox horizontal gap={12}>
              <Form.Item
                label="Host"
                name="host"
                rules={[{ required: true, message: 'Host is required' }]}
                style={{ flex: 3 }}
              >
                <Input prefix={<Server size={14} />} placeholder="hostname or IP" />
              </Form.Item>
              <Form.Item label="Port" name="port" style={{ flex: 1 }}>
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Flexbox>

            <Form.Item
              label="Username"
              name="username"
              rules={[{ required: true, message: 'Username is required' }]}
            >
              <Input prefix={<User size={14} />} placeholder="ssh user" />
            </Form.Item>

            <Divider style={{ margin: '12px 0' }} />

            <Form.Item label="Authentication" name="auth_type">
              <Select options={authTypeOptions} />
            </Form.Item>

            {authType === 'key_file' && (
              <Form.Item label="Private Key" name="key_path">
                <Select
                  showSearch
                  placeholder="Select a key from ~/.ssh/"
                  options={keyOptions}
                  optionFilterProp="value"
                  allowClear
                  dropdownRender={(menu) => (
                    <>
                      {menu}
                      <Divider style={{ margin: '4px 0' }} />
                      <div style={{ padding: '4px 12px 8px', fontSize: 12, color: token.colorTextTertiary }}>
                        Or type a custom path below
                      </div>
                    </>
                  )}
                  notFoundContent={
                    <div style={{ padding: 12, textAlign: 'center', color: token.colorTextTertiary, fontSize: 13 }}>
                      No keys found in ~/.ssh/
                    </div>
                  }
                />
              </Form.Item>
            )}

            {authType === 'password' && (
              <Form.Item label="Password" name="password">
                <Input.Password prefix={<Lock size={14} />} placeholder="SSH password" />
              </Form.Item>
            )}

            {authType === 'agent' && (
              <Alert
                type="info"
                message="Uses the running SSH agent (SSH_AUTH_SOCK) for authentication."
                style={{ marginBottom: 12 }}
                showIcon
              />
            )}
          </>
        )}

        {/* Passphrase field — shown for key-based auth */}
        {((mode === 'connect' &&
          connection &&
          (connection.auth_type === 'key_file' || connection.auth_type === 'key')) ||
          (isEditing && (authType === 'key_file' || authType === 'key')) ||
          needsPassphrase) && (
          <>
            <Divider plain style={{ margin: '8px 0 12px', fontSize: 12, color: token.colorTextTertiary }}>
              Key Passphrase (if encrypted)
            </Divider>
            <Form.Item name="passphrase" extra="Not stored — you'll be asked each time the key requires it.">
              <Input.Password
                prefix={<KeyRound size={14} />}
                placeholder="Passphrase for private key (leave empty if none)"
              />
            </Form.Item>
          </>
        )}

        {mode === 'connect' && connection && (
          <div style={{ padding: '8px 0', color: token.colorTextSecondary, fontSize: 13 }}>
            Connecting to <strong>{connection.username}@{connection.host}:{connection.port}</strong>
            {connection.auth_type === 'key_file' && connection.key_path && (
              <span> using key <code style={{ fontSize: 12 }}>{connection.key_path}</code></span>
            )}
          </div>
        )}

        {mode === 'add' && (
          <Flexbox horizontal gap={16} style={{ marginTop: 8 }}>
            <Form.Item name="connect_now" valuePropName="checked" initialValue={true} style={{ marginBottom: 0 }}>
              <Switch checkedChildren="Connect now" unCheckedChildren="Save only" defaultChecked />
            </Form.Item>
          </Flexbox>
        )}
      </Form>
    </Modal>
  );
}
