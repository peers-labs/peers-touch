import { useCallback, useMemo, useState } from 'react';
import type { HTMLAttributes } from 'react';
import {
  Alert,
  App,
  Button,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import {
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { usePolling } from '../hooks/usePolling';
import * as relayApi from '../api/relayAttachments';
import { formatRelativeTime } from '../utils/format';
import { log } from '../utils/logger';

const { Text } = Typography;
const { TextArea } = Input;

const STATE_PRESENTATION: Record<
  relayApi.RelayAttachmentState,
  { color: string; label: string }
> = {
  attaching: { color: 'processing', label: 'Attaching' },
  active: { color: 'success', label: 'Active' },
  recovering: { color: 'warning', label: 'Recovering' },
  cleanup_pending: { color: 'warning', label: 'Cleanup pending' },
  detached: { color: 'default', label: 'Detached' },
};

export default function RelayAttachmentsPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [attachments, setAttachments] = useState<relayApi.RelayAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [invitationJSON, setInvitationJSON] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [mutatingRelay, setMutatingRelay] = useState('');

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      setAttachments(await relayApi.listRelayAttachments());
      setLoadError('');
    } catch (error) {
      log.error('relay-attachments', 'Failed to load Relay attachments', {
        error: String(error),
      });
      setLoadError(errorMessage(error, 'Failed to load Relay attachments'));
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(() => {
    load(false).catch(() => {});
  }, 3000);

  const submitInvitation = useCallback(async () => {
    setImportError('');
    let invitation: relayApi.RelayInvitation;
    try {
      const parsed = JSON.parse(invitationJSON) as {
        invitation?: relayApi.RelayInvitation;
      } & Partial<relayApi.RelayInvitation>;
      invitation = (parsed.invitation || parsed) as relayApi.RelayInvitation;
      if (!invitation.relay_peer_id || !invitation.invite_token) {
        throw new Error('Invitation JSON is incomplete');
      }
    } catch (error) {
      setImportError(errorMessage(error, 'Invitation JSON is invalid'));
      return;
    }

    setImporting(true);
    try {
      await relayApi.importRelayAttachment(invitation);
      setImportOpen(false);
      setInvitationJSON('');
      message.success('Relay attachment accepted');
      await load(false);
    } catch (error) {
      setImportError(errorMessage(error, 'Relay attachment could not be imported'));
    } finally {
      setImporting(false);
    }
  }, [invitationJSON, load, message]);

  const mutate = useCallback(async (
    relayPeerID: string,
    action: 'retry' | 'delete',
  ) => {
    setMutatingRelay(relayPeerID);
    try {
      if (action === 'retry') {
        await relayApi.retryRelayAttachment(relayPeerID);
        message.success('Relay attachment retry started');
      } else {
        const result = await relayApi.deleteRelayAttachment(relayPeerID);
        message.success(
          result.cleanup_pending
            ? 'Local Relay use stopped; remote cleanup is pending'
            : 'Relay attachment deleted',
        );
      }
      await load(false);
    } catch (error) {
      message.error(errorMessage(error, 'Relay attachment operation failed'));
    } finally {
      setMutatingRelay('');
    }
  }, [load, message]);

  const columns = useMemo<ColumnsType<relayApi.RelayAttachment>>(() => [
    {
      title: 'Relay',
      key: 'relay',
      width: 220,
      render: (_, attachment) => (
        <Flexbox gap={3} style={{ minWidth: 0 }}>
          <Flexbox horizontal align="center" gap={6}>
            <Text strong ellipsis={{ tooltip: attachment.label || attachment.relay_peer_id }}>
              {attachment.label || 'Relay'}
            </Text>
            <Tag
              color={(STATE_PRESENTATION[attachment.state] || STATE_PRESENTATION.recovering).color}
              style={{ margin: 0 }}
            >
              {(STATE_PRESENTATION[attachment.state] || STATE_PRESENTATION.recovering).label}
            </Tag>
          </Flexbox>
          <Text
            code
            copyable
            ellipsis={{ tooltip: attachment.relay_peer_id }}
            style={{ maxWidth: 280, fontSize: 11 }}
          >
            {attachment.relay_peer_id}
          </Text>
        </Flexbox>
      ),
    },
    {
      title: 'Control origin',
      dataIndex: 'control_origin',
      key: 'control_origin',
      responsive: ['lg'],
      render: (origin: string) => (
        <Text code ellipsis={{ tooltip: origin }} style={{ maxWidth: 300, fontSize: 12 }}>
          {origin}
        </Text>
      ),
    },
    {
      title: 'Route',
      key: 'route',
      responsive: ['lg'],
      width: 170,
      render: (_, attachment) => (
        attachment.route_expires_at ? (
          <Flexbox gap={2}>
            <Text>{formatRelativeTime(attachment.route_expires_at)}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              generation {attachment.route_generation}
            </Text>
          </Flexbox>
        ) : <Text type="secondary">Not published</Text>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      fixed: 'right',
      render: (_, attachment) => (
        <Flexbox
          horizontal
          align="center"
          justify="flex-end"
          gap={4}
          data-ui-controls-align="end"
        >
          {(attachment.state === 'recovering' || attachment.cleanup_pending) && (
            <Tooltip title="Retry">
              <Button
                aria-label={`Retry ${attachment.label || attachment.relay_peer_id}`}
                icon={<RotateCcw size={14} />}
                loading={mutatingRelay === attachment.relay_peer_id}
                onClick={() => mutate(attachment.relay_peer_id, 'retry')}
                shape="circle"
                size="small"
                type="text"
              />
            </Tooltip>
          )}
          {attachment.enabled && (
            <Popconfirm
              title="Delete this Relay attachment?"
              description="Local use stops before remote enrollment cleanup."
              okButtonProps={{ danger: true }}
              okText="Delete"
              onConfirm={() => mutate(attachment.relay_peer_id, 'delete')}
            >
              <Tooltip title="Delete">
                <Button
                  aria-label={`Delete ${attachment.label || attachment.relay_peer_id}`}
                  danger
                  icon={<Trash2 size={14} />}
                  loading={mutatingRelay === attachment.relay_peer_id}
                  shape="circle"
                  size="small"
                  type="text"
                />
              </Tooltip>
            </Popconfirm>
          )}
        </Flexbox>
      ),
    },
  ], [mutate, mutatingRelay]);

  return (
    <Flexbox gap={0} style={{ minWidth: 0 }}>
      <PageHeader
        title="Relays"
        subtitle="Attachment routes for this Station"
        extra={(
          <>
            <Tooltip title="Refresh">
              <Button
                aria-label="Refresh Relay attachments"
                icon={<RefreshCw size={15} />}
                loading={loading}
                onClick={() => load(true)}
                shape="circle"
                type="text"
              />
            </Tooltip>
            <Button
              icon={<Plus size={15} />}
              onClick={() => {
                setImportError('');
                setImportOpen(true);
              }}
              type="primary"
            >
              Import invitation
            </Button>
          </>
        )}
      />

      <Flexbox gap={12} style={{ padding: 24, minWidth: 0 }}>
        {loadError && (
          <Alert
            action={<Button onClick={() => load(true)} size="small">Retry</Button>}
            message={loadError}
            showIcon
            type="error"
          />
        )}

        <div
          data-ui-rows="relay-attachments"
          style={{
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadius,
            overflow: 'hidden',
          }}
        >
          <Table
            columns={columns}
            dataSource={attachments}
            loading={loading}
            locale={{ emptyText: 'No Relay attachments' }}
            onRow={() => ({
              'data-ui-row': 'relay-attachment',
            }) as HTMLAttributes<HTMLTableRowElement>}
            pagination={false}
            rowKey="relay_peer_id"
            scroll={{ x: 720 }}
            size="middle"
            expandable={{
              expandedRowRender: (attachment) => (
                <Flexbox gap={8} style={{ padding: '4px 8px 8px 40px' }}>
                  <Text strong style={{ fontSize: 12 }}>Dial addresses</Text>
                  {attachment.dial_addresses.map((address) => (
                    <Text code copyable key={address} style={{ fontSize: 11 }}>
                      {address}
                    </Text>
                  ))}
                  {attachment.last_error && (
                    <Alert
                      message={attachment.last_error}
                      showIcon
                      type="warning"
                    />
                  )}
                </Flexbox>
              ),
            }}
          />
        </div>
      </Flexbox>

      <Modal
        destroyOnHidden
        maskClosable={!importing}
        okButtonProps={{ loading: importing }}
        okText="Import"
        onCancel={() => setImportOpen(false)}
        onOk={submitInvitation}
        open={importOpen}
        title="Import Relay invitation"
        width={620}
      >
        <Flexbox gap={12} style={{ paddingTop: 8 }}>
          {importError && <Alert message={importError} showIcon type="error" />}
          <TextArea
            autoFocus
            disabled={importing}
            onChange={(event) => setInvitationJSON(event.target.value)}
            placeholder='{"schema_version":1,"relay_peer_id":"..."}'
            rows={10}
            value={invitationJSON}
          />
          <Space size={6}>
            <Tag>One use</Tag>
            <Text type="secondary">The invitation secret is not stored.</Text>
          </Space>
        </Flexbox>
      </Modal>
    </Flexbox>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    const responseMessage = (
      error as Error & { response?: { data?: { error?: string; message?: string } } }
    ).response?.data;
    return responseMessage?.error || responseMessage?.message || error.message;
  }
  return fallback;
}
