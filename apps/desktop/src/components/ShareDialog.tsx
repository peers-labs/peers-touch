import { useState, useCallback, useMemo } from 'react';
import { Modal, Tabs, theme } from 'antd';
import { Button, toast } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';
import { Copy, Link, FileText, Download, Check, Link2Off } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/desktop_api';
import type { ChatMessage } from '../store/chat';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  sessionKey: string;
  messages: ChatMessage[];
  title?: string;
}

function generateMarkdown(messages: ChatMessage[], title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(`# ${title}`, '');

  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const role = msg.role === 'user' ? '**User**' : msg.role === 'assistant' ? '**Assistant**' : `**${msg.role}**`;
    lines.push(`### ${role}`, '');

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        lines.push(`> Tool: \`${tc.name}\``);
        if (tc.args) lines.push(`> Args: \`${tc.args}\``);
        if (tc.result) lines.push('> Result:', `> ${tc.result.split('\n').join('\n> ')}`);
        lines.push('');
      }
    }

    if (msg.content) lines.push(msg.content, '');
    lines.push('---', '');
  }

  return lines.join('\n');
}

export function ShareDialog({ open, onClose, sessionKey, messages, title }: ShareDialogProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('share');
  const [copied, setCopied] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [sharing, setSharing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const markdownText = useMemo(() => generateMarkdown(messages, title), [messages, title]);

  const handleCopyText = useCallback(() => {
    navigator.clipboard.writeText(markdownText).then(() => {
      setCopied(true);
      toast.success(t('share.toast.copiedMarkdown'));
      setTimeout(() => setCopied(false), 2000);
    });
  }, [markdownText]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([markdownText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'conversation'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [markdownText, title]);

  const handleCreateLink = useCallback(async () => {
    setSharing(true);
    try {
      const result = await api.createShare(sessionKey);
      const url = `${window.location.origin}/share/s/${result.share_id}`;
      setShareLink(url);
    } catch {
      toast.error(t('share.toast.createFailed'));
    } finally {
      setSharing(false);
    }
  }, [sessionKey]);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(shareLink).then(() => {
      setLinkCopied(true);
      toast.success(t('share.toast.linkCopied'));
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }, [shareLink]);

  const handleRevokeLink = useCallback(async () => {
    setRevoking(true);
    try {
      await api.deleteShare(sessionKey);
      setShareLink('');
      toast.success(t('share.toast.linkRevoked'));
    } catch {
      toast.error(t('share.toast.revokeFailed'));
    } finally {
      setRevoking(false);
    }
  }, [sessionKey]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t('share.title')}
      footer={null}
      width={520}
    >
      <Tabs
        items={[
          {
            key: 'text',
            label: (
              <Flexbox horizontal align="center" gap={6}>
                <FileText size={14} />
                <span>{t('share.tab.text')}</span>
              </Flexbox>
            ),
            children: (
              <Flexbox gap={12}>
                <div
                  className="selectable"
                  style={{
                    maxHeight: 300,
                    overflow: 'auto',
                    padding: 12,
                    borderRadius: 8,
                    background: token.colorFillQuaternary,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    fontSize: 12,
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: token.colorTextSecondary,
                  }}
                >
                  {markdownText.slice(0, 2000)}
                  {markdownText.length > 2000 && '\n\n... ' + t('share.truncatedPreview')}
                </div>
                <Flexbox horizontal gap={8}>
                  <Button
                    icon={copied ? <Check size={14} /> : <Copy size={14} />}
                    onClick={handleCopyText}
                    type={copied ? 'default' : 'primary'}
                  >
                    {copied ? t('share.action.copied') : t('share.action.copyMarkdown')}
                  </Button>
                  <Button
                    icon={<Download size={14} />}
                    onClick={handleDownload}
                  >
                    {t('share.action.downloadMd')}
                  </Button>
                </Flexbox>
              </Flexbox>
            ),
          },
          {
            key: 'link',
            label: (
              <Flexbox horizontal align="center" gap={6}>
                <Link size={14} />
                <span>{t('share.tab.link')}</span>
              </Flexbox>
            ),
            children: (
              <Flexbox gap={12}>
                <p style={{ color: token.colorTextSecondary, fontSize: 13, margin: 0 }}>
                  {t('share.link.description')}
                </p>
                {!shareLink ? (
                  <Button
                    type="primary"
                    onClick={handleCreateLink}
                    loading={sharing}
                    icon={<Link size={14} />}
                  >
                    {sharing ? t('share.action.creating') : t('share.action.createShareLink')}
                  </Button>
                ) : (
                  <Flexbox gap={8}>
                    <Flexbox
                      horizontal
                      align="center"
                      gap={8}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        background: token.colorFillQuaternary,
                        border: `1px solid ${token.colorBorderSecondary}`,
                      }}
                    >
                      <span
                        className="selectable"
                        style={{
                          flex: 1,
                          fontSize: 13,
                          color: token.colorText,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {shareLink}
                      </span>
                      <Button
                        size="small"
                        type={linkCopied ? 'default' : 'primary'}
                        icon={linkCopied ? <Check size={12} /> : <Copy size={12} />}
                        onClick={handleCopyLink}
                      >
                        {linkCopied ? t('share.action.copied') : t('share.action.copy')}
                      </Button>
                    </Flexbox>
                    <Button
                      danger
                      size="small"
                      icon={<Link2Off size={12} />}
                      onClick={handleRevokeLink}
                      loading={revoking}
                    >
                      {t('share.action.revokeLink')}
                    </Button>
                  </Flexbox>
                )}
              </Flexbox>
            ),
          },
        ]}
      />
    </Modal>
  );
}
