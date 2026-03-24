import { useState, useEffect, useCallback } from 'react';
import { Drawer, Button, List, Tag, Popconfirm, Empty, Tooltip, message, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import {
  Plus,
  Trash2,
  Edit3,
  Download,
  Server,
  KeyRound,
  Lock,
  Shield,
  Plug,
} from 'lucide-react';
import { api } from '../../services/desktop_api';
import type { Connection } from './types';

interface SSHConfigHost {
  alias: string;
  hostname: string;
  user?: string;
  port?: number;
  identity_file?: string;
}

export interface ServerManagerProps {
  open: boolean;
  onClose: () => void;
  connections: Connection[];
  onRefresh: () => void;
  onEdit: (conn: Connection) => void;
  onAdd: () => void;
  onConnect: (conn: Connection) => void;
}

const authIcon: Record<string, React.ReactNode> = {
  key_file: <KeyRound size={13} />,
  key: <KeyRound size={13} />,
  password: <Lock size={13} />,
  agent: <Shield size={13} />,
};

const authLabel: Record<string, string> = {
  key_file: 'Key File',
  key: 'Key',
  password: 'Password',
  agent: 'SSH Agent',
};

export function ServerManager({
  open,
  onClose,
  connections,
  onRefresh,
  onEdit,
  onAdd,
  onConnect,
}: ServerManagerProps) {
  const { token } = theme.useToken();
  const [sshHosts, setSSHHosts] = useState<SSHConfigHost[]>([]);
  const [importing, setImporting] = useState(false);

  const loadSSHConfig = useCallback(async () => {
    try {
      const data = await api.appletAction<{ hosts: SSHConfigHost[] }>(
        'remote-cli',
        'parse-ssh-config',
      );
      setSSHHosts(data.hosts || []);
    } catch {
      // no ssh config
    }
  }, []);

  useEffect(() => {
    if (open) loadSSHConfig();
  }, [open, loadSSHConfig]);

  const handleDelete = async (id: string) => {
    try {
      await api.appletAction('remote-cli', 'remove-connection', { id });
      message.success('Connection removed');
      onRefresh();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleImport = async (host: SSHConfigHost) => {
    setImporting(true);
    try {
      await api.appletAction('remote-cli', 'add-connection', {
        name: host.alias,
        host: host.hostname,
        port: host.port || 22,
        username: host.user || '',
        auth_type: host.identity_file ? 'key_file' : 'agent',
        key_path: host.identity_file || '',
      });
      message.success(`Imported "${host.alias}"`);
      onRefresh();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setImporting(false);
    }
  };

  const handleImportAll = async () => {
    const existingNames = new Set(connections.map((c) => c.name));
    const toImport = sshHosts.filter((h) => !existingNames.has(h.alias));
    if (toImport.length === 0) {
      message.info('All SSH config hosts are already imported');
      return;
    }
    setImporting(true);
    let count = 0;
    for (const host of toImport) {
      try {
        await api.appletAction('remote-cli', 'add-connection', {
          name: host.alias,
          host: host.hostname,
          port: host.port || 22,
          username: host.user || '',
          auth_type: host.identity_file ? 'key_file' : 'agent',
          key_path: host.identity_file || '',
        });
        count++;
      } catch {
        // skip
      }
    }
    message.success(`Imported ${count} host(s)`);
    onRefresh();
    setImporting(false);
  };

  const isImported = (host: SSHConfigHost) =>
    connections.some(
      (c) => c.host === host.hostname && c.username === (host.user || '') && c.name === host.alias,
    );

  return (
    <Drawer
      title={
        <Flexbox horizontal align="center" gap={8}>
          <Server size={18} style={{ color: token.colorPrimary }} />
          <span>Server Connections</span>
        </Flexbox>
      }
      open={open}
      onClose={onClose}
      size="default"
      extra={
        <Button type="primary" icon={<Plus size={14} />} onClick={onAdd}>
          New
        </Button>
      }
    >
      {/* Saved connections */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: token.colorTextSecondary }}>
          Saved Connections
        </div>
        {connections.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No saved connections"
            style={{ margin: '16px 0' }}
          >
            <Button type="primary" icon={<Plus size={14} />} onClick={onAdd}>
              Add Connection
            </Button>
          </Empty>
        ) : (
          <List
            size="small"
            dataSource={connections}
            renderItem={(conn) => (
              <List.Item
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  marginBottom: 4,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                }}
                actions={[
                  <Tooltip key="connect" title="Connect">
                    <Button
                      type="link"
                      size="small"
                      icon={<Plug size={14} />}
                      onClick={() => onConnect(conn)}
                    />
                  </Tooltip>,
                  <Tooltip key="edit" title="Edit">
                    <Button
                      type="link"
                      size="small"
                      icon={<Edit3 size={14} />}
                      onClick={() => onEdit(conn)}
                    />
                  </Tooltip>,
                  <Popconfirm
                    key="delete"
                    title="Remove this connection?"
                    onConfirm={() => handleDelete(conn.id)}
                    okText="Remove"
                    cancelText="Cancel"
                  >
                    <Tooltip title="Remove">
                      <Button type="link" size="small" danger icon={<Trash2 size={14} />} />
                    </Tooltip>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <Server
                      size={18}
                      style={{ marginTop: 4, color: token.colorPrimary }}
                    />
                  }
                  title={
                    <Flexbox horizontal align="center" gap={6}>
                      <span style={{ fontSize: 14 }}>{conn.name}</span>
                      <Tag
                        bordered={false}
                        style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}
                      >
                        {authIcon[conn.auth_type]}
                        {authLabel[conn.auth_type] || conn.auth_type}
                      </Tag>
                    </Flexbox>
                  }
                  description={
                    <span style={{ fontSize: 12, fontFamily: 'monospace' }}>
                      {conn.username}@{conn.host}:{conn.port}
                      {conn.key_path && (
                        <span style={{ marginLeft: 8, opacity: 0.6 }}>{conn.key_path}</span>
                      )}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </div>

      {/* SSH Config discovery */}
      {sshHosts.length > 0 && (
        <>
          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            style={{ marginBottom: 8 }}
          >
            <span style={{ fontWeight: 600, fontSize: 13, color: token.colorTextSecondary }}>
              From ~/.ssh/config
            </span>
            <Button
              size="small"
              icon={<Download size={12} />}
              onClick={handleImportAll}
              loading={importing}
            >
              Import All
            </Button>
          </Flexbox>

          <List
            size="small"
            dataSource={sshHosts}
            renderItem={(host) => {
              const imported = isImported(host);
              return (
                <List.Item
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    marginBottom: 4,
                    border: `1px dashed ${token.colorBorderSecondary}`,
                    opacity: imported ? 0.5 : 1,
                  }}
                  actions={
                    imported
                      ? [<Tag key="imported" color="green">Imported</Tag>]
                      : [
                          <Button
                            key="import"
                            size="small"
                            icon={<Download size={12} />}
                            onClick={() => handleImport(host)}
                            loading={importing}
                          >
                            Import
                          </Button>,
                        ]
                  }
                >
                  <List.Item.Meta
                    avatar={<Server size={16} style={{ marginTop: 2, opacity: 0.6 }} />}
                    title={<span style={{ fontSize: 13 }}>{host.alias}</span>}
                    description={
                      <span style={{ fontSize: 12, fontFamily: 'monospace' }}>
                        {host.user ? `${host.user}@` : ''}
                        {host.hostname}
                        {host.port && host.port !== 22 ? `:${host.port}` : ''}
                        {host.identity_file && (
                          <span style={{ marginLeft: 8, opacity: 0.5 }}>{host.identity_file}</span>
                        )}
                      </span>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </>
      )}
    </Drawer>
  );
}
