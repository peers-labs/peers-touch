import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  ConfirmAction,
  Empty,
  Icon,
  IconButton,
  Spin,
  Tag,
  TextField,
  TextArea,
  type Tone,
} from '@peers-touch/ui';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { KnowledgeResourceDescriptor } from '../../gen/proto/domain/agent/capability_pb';
import {
  KnowledgeResourceAvailability,
  KnowledgeResourceKind,
} from '../../gen/proto/domain/agent/capability_pb';
import { useAgentCapabilityStore } from '../../store/agentCapabilities';
import { knowledgeService } from '../../services/knowledge-service';
import { log } from '../../utils/logger';

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
    <div
      aria-hidden
      className="sc-knowledge-cover"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 42% 92%), hsl(${(hue + 48) % 360} 46% 84%))`,
      }}
    >
      {initials || <Icon iconId="book-open" size={24} />}
    </div>
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
    <div className="sc-knowledge-editor" data-pt-knowledge-editor>
      <div className="sc-knowledge-editor__head">
        <IconButton
          actionId="knowledge-editor-back"
          iconId="arrow-left"
          iconSize={16}
          density="compact"
          emphasis="quiet"
          label={t('settings.knowledge.back')}
          onActivate={onCancel}
        />
        <strong>{initial ? t('settings.knowledge.editTitle') : t('settings.knowledge.createTitle')}</strong>
      </div>
      <TextField
        autoFocus
        aria-label={t('settings.knowledge.titleLabel')}
        placeholder={t('settings.knowledge.titlePlaceholder')}
        value={title}
        onValueChange={setTitle}
      />
      <TextArea
        aria-label={t('settings.knowledge.contentLabel')}
        placeholder={t('settings.knowledge.contentPlaceholder')}
        rows={13}
        value={content}
        onValueChange={setContent}
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      <div className="sc-knowledge-editor__actions">
        <Button
          actionId="knowledge-editor-cancel"
          label={t('settings.knowledge.cancel')}
          onActivate={onCancel}
        />
        <Button
          actionId="knowledge-editor-save"
          emphasis="primary"
          execution={submitting ? 'pending' : 'idle'}
          label={t('settings.knowledge.save')}
          onActivate={() => void submit()}
        />
      </div>
    </div>
  );
}

function KnowledgeReader({ descriptor, onBack }: {
  descriptor: KnowledgeResourceDescriptor;
  onBack: () => void;
}) {
  const { t } = useTranslation('settings');
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
    <div className="sc-knowledge-reader" data-pt-knowledge-reader>
      <div className="sc-knowledge-reader__head">
        <IconButton
          actionId="knowledge-reader-back"
          iconId="arrow-left"
          iconSize={16}
          density="compact"
          emphasis="quiet"
          label={t('settings.knowledge.back')}
          onActivate={onBack}
        />
        <strong className="sc-knowledge-reader__title">{descriptor.title}</strong>
        <Tag>r{Number(descriptor.revision)}</Tag>
      </div>
      {loading ? (
        <div className="sc-knowledge-loading"><Spin /></div>
      ) : null}
      {error ? <Alert tone="danger" title={error} /> : null}
      {!loading && !error ? (
        <div className="sc-knowledge-reader__content selectable">
          {content}
        </div>
      ) : null}
    </div>
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
  }, [descriptor, onBack, onChanged]);

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

  const availabilityTone: Tone = descriptor.availability === KnowledgeResourceAvailability.READY
    ? 'success'
    : 'warning';

  return (
    <div className="sc-knowledge-detail" data-pt-knowledge-detail>
      <div className="sc-knowledge-detail__head">
        <IconButton
          actionId="knowledge-detail-back"
          iconId="arrow-left"
          iconSize={16}
          density="compact"
          emphasis="quiet"
          label={t('settings.knowledge.back')}
          onActivate={onBack}
        />
        <strong className="sc-knowledge-detail__title">{descriptor.title}</strong>
        <Tag tone="info">{resourceKindLabel(descriptor.resourceKind)}</Tag>
        <Tag>r{Number(descriptor.revision)}</Tag>
      </div>
      <div className="sc-knowledge-detail__tags">
        <Tag tone={availabilityTone}>
          {descriptor.availability === KnowledgeResourceAvailability.READY
            ? t('settings.knowledge.retrievalLocal')
            : t('settings.knowledge.unavailable')}
        </Tag>
        <Tag>{descriptor.contentHash.slice(0, 16)}</Tag>
      </div>
      <Alert tone="info" title={t('settings.knowledge.retrievalNotice')} />
      <div className="sc-knowledge-detail__actions">
        <Button
          actionId="knowledge-open-reader"
          label={t('settings.knowledge.openReader')}
          onActivate={() => setReaderOpen(true)}
        />
        <Button
          actionId="knowledge-add-revision"
          execution={submitting ? 'pending' : 'idle'}
          label={t('settings.knowledge.addRevision')}
          onActivate={() => void editFromStation()}
        />
        <ConfirmAction
          actionId="knowledge-tombstone"
          title={t('settings.knowledge.tombstoneConfirm')}
          confirmLabel={t('settings.knowledge.tombstone')}
          cancelLabel={t('settings.knowledge.cancel')}
          onConfirm={() => void tombstone()}
        >
          <Button
            actionId="knowledge-tombstone-trigger"
            tone="danger"
            leading={<Icon iconId="delete" size={14} />}
            label={t('settings.knowledge.tombstone')}
          />
        </ConfirmAction>
      </div>
    </div>
  );
}

export function KnowledgeSettings() {
  const { t } = useTranslation('settings');
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
      <Card flat data-pt-settings-knowledge>
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
      <Card flat data-pt-settings-knowledge>
        <KnowledgeReader
          descriptor={view.descriptor}
          onBack={() => setView({ mode: 'detail', descriptor: view.descriptor })}
        />
      </Card>
    );
  }

  if (view.mode === 'detail') {
    return (
      <Card flat data-pt-settings-knowledge>
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
      flat
      data-pt-settings-knowledge
      heading={(
        <span className="sc-knowledge-heading">
          <Icon iconId="book-open" size={16} />
          <span>{t('settings.knowledge.title')}</span>
        </span>
      )}
      actions={(
        <span className="sc-knowledge-heading__actions">
          <IconButton
            actionId="knowledge-refresh"
            iconId="refresh-cw"
            iconSize={15}
            density="compact"
            emphasis="quiet"
            label={t('settings.knowledge.refresh')}
            onActivate={() => void refresh()}
          />
          <Button
            actionId="knowledge-create"
            emphasis="primary"
            density="compact"
            leading={<Plus size={14} />}
            label={t('settings.knowledge.create')}
            onActivate={() => setView({ mode: 'create' })}
          />
        </span>
      )}
    >
      <div className="sc-knowledge-list">
        <Alert tone="info" title={t('settings.knowledge.retrievalNotice')} />
        <TextField
          clearable
          leading={<Icon iconId="search" size={14} />}
          value={query}
          placeholder={t('settings.knowledge.search')}
          onValueChange={setQuery}
        />
        {loading ? (
          <div className="sc-knowledge-loading"><Spin /></div>
        ) : null}
        {!loading && visible.length === 0 ? (
          <div className="sc-knowledge-empty">
            <Empty
              icon={<Icon iconId="book-open" size={40} />}
              description={query
                ? t('settings.knowledge.emptySearch')
                : t('settings.knowledge.empty')}
            />
          </div>
        ) : null}
        {!loading ? (
          <div className="sc-knowledge-grid" data-pt-knowledge-grid>
            {visible.map((descriptor) => (
              <button
                key={descriptor.resourceId}
                type="button"
                className="sc-knowledge-card"
                data-pt-knowledge-card={descriptor.resourceId}
                onClick={() => setView({ mode: 'detail', descriptor })}
              >
                <KnowledgeCover descriptor={descriptor} />
                <div className="sc-knowledge-card__body">
                  <strong className="sc-knowledge-card__title">
                    {descriptor.title}
                  </strong>
                  <span className="sc-knowledge-card__tags">
                    <Tag>r{Number(descriptor.revision)}</Tag>
                    <Tag tone={descriptor.availability === KnowledgeResourceAvailability.READY
                      ? 'success'
                      : 'warning'}
                    >
                      {descriptor.availability === KnowledgeResourceAvailability.READY
                        ? t('settings.knowledge.retrievalLocalShort')
                        : t('settings.knowledge.unavailableShort')}
                    </Tag>
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
