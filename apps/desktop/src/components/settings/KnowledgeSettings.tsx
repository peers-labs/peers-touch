import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Input, Popconfirm, Spin, Tag, theme } from 'antd';
import { ActionIcon, Empty as LobeEmpty } from '@lobehub/ui';
import { ArrowLeft, BookOpen, Package, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import type { KnowledgeResourceDescriptor } from '../../gen/proto/domain/agent/capability_pb';
import {
  KnowledgeResourceAvailability,
  KnowledgeResourceKind,
} from '../../gen/proto/domain/agent/capability_pb';
import { useAgentCapabilityStore } from '../../store/agentCapabilities';
import { knowledgeService } from '../../services/knowledge-service';
import { log } from '../../utils/logger';

const { TextArea } = Input;

type View =
  | { mode: 'list' }
  | { mode: 'create' }
  | { mode: 'detail'; descriptor: KnowledgeResourceDescriptor }
  | { mode: 'reader'; descriptor: KnowledgeResourceDescriptor };

function resourceKindLabel(kind: KnowledgeResourceKind): string {
  return KnowledgeResourceKind[kind]?.replace('KNOWLEDGE_RESOURCE_KIND_', '').toLowerCase() || 'unknown';
}

function deterministicHue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function KnowledgeCover({ descriptor }: { descriptor: KnowledgeResourceDescriptor }) {
  const initials = descriptor.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
  const hue = deterministicHue(descriptor.resourceId);
  return (
    <Flexbox
      aria-hidden
      align="center"
      justify="center"
      style={{
        height: 92,
        color: '#3f3b63',
        fontSize: 25,
        fontWeight: 750,
        letterSpacing: '0.04em',
        background: `linear-gradient(135deg, hsl(${hue} 42% 92%), hsl(${(hue + 48) % 360} 46% 84%))`,
      }}
    >
      {initials || <BookOpen size={24} />}
    </Flexbox>
  );
}

function KnowledgeEditor({
  initial,
  submitting,
  onCancel,
  onSubmit,
}: {
  initial?: { title: string; content: string };
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (title: string, content: string) => Promise<void>;
}) {
  const { t } = useTranslation('settings');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [error, setError] = useState('');

  const submit = useCallback(async () => {
    const nextTitle = title.trim();
    const nextContent = content.trim();
    if (!nextTitle || !nextContent) {
      setError(t('settings.knowledge.error.fieldsRequired'));
      return;
    }
    setError('');
    await onSubmit(nextTitle, nextContent);
  }, [content, onSubmit, t, title]);

  return (
    <Flexbox gap={12} data-pt-knowledge-editor>
      <Flexbox horizontal align="center" gap={8}>
        <ActionIcon icon={ArrowLeft} title={t('settings.knowledge.back')} onClick={onCancel} />
        <strong>{initial ? t('settings.knowledge.editTitle') : t('settings.knowledge.createTitle')}</strong>
      </Flexbox>
      <Input
        autoFocus
        aria-label={t('settings.knowledge.titleLabel')}
        placeholder={t('settings.knowledge.titlePlaceholder')}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <TextArea
        aria-label={t('settings.knowledge.contentLabel')}
        placeholder={t('settings.knowledge.contentPlaceholder')}
        rows={13}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        style={{ fontFamily: 'inherit' }}
      />
      {error ? <Alert type="error" showIcon message={error} /> : null}
      <Flexbox horizontal justify="flex-end" gap={8}>
        <Button onClick={onCancel}>{t('settings.knowledge.cancel')}</Button>
        <Button type="primary" loading={submitting} onClick={() => { void submit(); }}>
          {t('settings.knowledge.save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

function KnowledgeReader({ descriptor, onBack }: {
  descriptor: KnowledgeResourceDescriptor;
  onBack: () => void;
}) {
  const { t } = useTranslation('settings');
  const { token } = theme.useToken();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    knowledgeService.readContent(descriptor)
      .then((result) => {
        if (active) setContent(result.content);
      })
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        log.error('knowledge', 'Failed to read Station content', { error: message });
        if (active) setError(t('settings.knowledge.error.readFailed'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [descriptor, t]);

  return (
    <Flexbox gap={12} data-pt-knowledge-reader>
      <Flexbox horizontal align="center" gap={8}>
        <ActionIcon icon={ArrowLeft} title={t('settings.knowledge.back')} onClick={onBack} />
        <strong style={{ minWidth: 0, flex: 1 }}>{descriptor.title}</strong>
        <Tag>r{Number(descriptor.revision)}</Tag>
      </Flexbox>
      {loading ? <Flexbox align="center" padding={32}><Spin /></Flexbox> : null}
      {error ? <Alert type="error" showIcon message={error} /> : null}
      {!loading && !error ? (
        <div
          className="selectable"
          style={{
            whiteSpace: 'pre-wrap',
            lineHeight: 1.65,
            fontSize: 13,
            padding: 14,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 10,
            maxHeight: 560,
            overflow: 'auto',
          }}
        >
          {content}
        </div>
      ) : null}
    </Flexbox>
  );
}

function KnowledgeDetail({ descriptor, onBack, onChanged }: {
  descriptor: KnowledgeResourceDescriptor;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation('settings');
  const [editing, setEditing] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [readerSeed, setReaderSeed] = useState<{ title: string; content: string } | null>(null);

  const tombstone = useCallback(async () => {
    await knowledgeService.tombstone(descriptor, t('settings.knowledge.tombstoneReason'));
    await onChanged();
    onBack();
  }, [descriptor, onBack, onChanged, t]);

  const editFromStation = useCallback(async () => {
    setSubmitting(true);
    try {
      const result = await knowledgeService.readContent(descriptor);
      setReaderSeed({ title: result.descriptor.title, content: result.content });
      setEditing(true);
    } catch (error) {
      log.error('knowledge', 'Failed to load content for edit', { error: String(error) });
    } finally {
      setSubmitting(false);
    }
  }, [descriptor]);

  if (readerOpen) {
    return <KnowledgeReader descriptor={descriptor} onBack={() => setReaderOpen(false)} />;
  }

  if (editing && readerSeed) {
    return (
      <KnowledgeEditor
        initial={readerSeed}
        submitting={submitting}
        onCancel={() => setEditing(false)}
        onSubmit={async (title, content) => {
          setSubmitting(true);
          try {
            await knowledgeService.updateDocument(descriptor, title, content);
            await onChanged();
            setEditing(false);
          } finally {
            setSubmitting(false);
          }
        }}
      />
    );
  }

  return (
    <Flexbox gap={12} data-pt-knowledge-detail>
      <Flexbox horizontal align="center" gap={8}>
        <ActionIcon icon={ArrowLeft} title={t('settings.knowledge.back')} onClick={onBack} />
        <strong style={{ minWidth: 0, flex: 1 }}>{descriptor.title}</strong>
        <Tag color="purple">{resourceKindLabel(descriptor.resourceKind)}</Tag>
        <Tag>r{Number(descriptor.revision)}</Tag>
      </Flexbox>
      <Flexbox horizontal gap={8} wrap="wrap">
        <Tag color="blue">{descriptor.availability === KnowledgeResourceAvailability.READY ? t('settings.knowledge.retrievalLocal') : t('settings.knowledge.unavailable')}</Tag>
        <Tag>{descriptor.contentHash.slice(0, 16)}</Tag>
      </Flexbox>
      <Alert type="info" showIcon message={t('settings.knowledge.retrievalNotice')} />
      <Flexbox horizontal gap={8}>
        <Button onClick={() => setReaderOpen(true)}>{t('settings.knowledge.openReader')}</Button>
        <Button onClick={() => void editFromStation()} loading={submitting}>{t('settings.knowledge.addRevision')}</Button>
        <Popconfirm title={t('settings.knowledge.tombstoneConfirm')} onConfirm={() => void tombstone()}>
          <Button danger icon={<Trash2 size={14} />}>{t('settings.knowledge.tombstone')}</Button>
        </Popconfirm>
      </Flexbox>
    </Flexbox>
  );
}

export function KnowledgeSettings() {
  const { t } = useTranslation('settings');
  const { token } = theme.useToken();
  const descriptors = useAgentCapabilityStore((state) => state.knowledgeDescriptors);
  const loading = useAgentCapabilityStore((state) => state.loadingKnowledgeDescriptors);
  const loadKnowledgeDescriptors = useAgentCapabilityStore((state) => state.loadKnowledgeDescriptors);
  const [view, setView] = useState<View>({ mode: 'list' });
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void loadKnowledgeDescriptors().catch((error) => {
      log.error('knowledge', 'Failed to load descriptors', { error: String(error) });
    });
  }, [loadKnowledgeDescriptors]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return descriptors
      .filter((item) => item.availability !== KnowledgeResourceAvailability.TOMBSTONED)
      .filter((item) => !normalized || item.title.toLowerCase().includes(normalized))
      .sort((left, right) => String(right.updatedAt?.seconds ?? 0).localeCompare(String(left.updatedAt?.seconds ?? 0)));
  }, [descriptors, query]);

  const refresh = useCallback(async () => {
    await loadKnowledgeDescriptors();
  }, [loadKnowledgeDescriptors]);

  if (view.mode === 'create') {
    return (
      <Card data-pt-settings-knowledge bordered={false}>
        <KnowledgeEditor
          submitting={submitting}
          onCancel={() => setView({ mode: 'list' })}
          onSubmit={async (title, content) => {
            setSubmitting(true);
            try {
              const descriptor = await knowledgeService.createDocument(title, content);
              await refresh();
              setView({ mode: 'detail', descriptor });
            } finally {
              setSubmitting(false);
            }
          }}
        />
      </Card>
    );
  }

  if (view.mode === 'reader') {
    return (
      <Card data-pt-settings-knowledge bordered={false}>
        <KnowledgeReader descriptor={view.descriptor} onBack={() => setView({ mode: 'detail', descriptor: view.descriptor })} />
      </Card>
    );
  }

  if (view.mode === 'detail') {
    return (
      <Card data-pt-settings-knowledge bordered={false}>
        <KnowledgeDetail
          descriptor={view.descriptor}
          onBack={() => setView({ mode: 'list' })}
          onChanged={refresh}
        />
      </Card>
    );
  }

  return (
    <Card
      data-pt-settings-knowledge
      bordered={false}
      title={(
        <Flexbox horizontal align="center" gap={8}>
          <BookOpen size={16} />
          <span>{t('settings.knowledge.title')}</span>
        </Flexbox>
      )}
      extra={(
        <Flexbox horizontal gap={8}>
          <ActionIcon icon={RefreshCw} title={t('settings.knowledge.refresh')} onClick={() => void refresh()} />
          <Button size="small" type="primary" icon={<Plus size={14} />} onClick={() => setView({ mode: 'create' })}>
            {t('settings.knowledge.create')}
          </Button>
        </Flexbox>
      )}
    >
      <Flexbox gap={12}>
        <Alert type="info" showIcon message={t('settings.knowledge.retrievalNotice')} />
        <Input.Search
          allowClear
          value={query}
          placeholder={t('settings.knowledge.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        {loading ? <Flexbox align="center" padding={32}><Spin /></Flexbox> : null}
        {!loading && visible.length === 0 ? (
          <LobeEmpty
            icon={Package}
            title={query ? t('settings.knowledge.emptySearch') : t('settings.knowledge.empty')}
            padding="48px 16px"
          />
        ) : null}
        {!loading ? (
          <div
            data-pt-knowledge-grid
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
              gap: 14,
            }}
          >
            {visible.map((descriptor) => (
              <button
                key={descriptor.resourceId}
                type="button"
                data-pt-knowledge-card={descriptor.resourceId}
                onClick={() => setView({ mode: 'detail', descriptor })}
                style={{
                  textAlign: 'left',
                  padding: 0,
                  overflow: 'hidden',
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 12,
                  background: token.colorBgContainer,
                  cursor: 'pointer',
                }}
              >
                <KnowledgeCover descriptor={descriptor} />
                <Flexbox gap={8} style={{ padding: '12px 14px 14px' }}>
                  <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {descriptor.title}
                  </strong>
                  <Flexbox horizontal gap={6} align="center">
                    <Tag>r{Number(descriptor.revision)}</Tag>
                    <Tag color={descriptor.availability === KnowledgeResourceAvailability.READY ? 'green' : 'orange'}>
                      {descriptor.availability === KnowledgeResourceAvailability.READY
                        ? t('settings.knowledge.retrievalLocalShort')
                        : t('settings.knowledge.unavailableShort')}
                    </Tag>
                  </Flexbox>
                </Flexbox>
              </button>
            ))}
          </div>
        ) : null}
      </Flexbox>
    </Card>
  );
}
