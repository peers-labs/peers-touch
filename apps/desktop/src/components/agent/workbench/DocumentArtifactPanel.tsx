import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, Tag, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { useTranslation } from 'react-i18next';
import { LazyMarkdown as Markdown } from '../../LazyMarkdown';
import { chatMarkdownProps } from '../../messages/markdownConfig';
import { useChatStore } from '../../../store/chat';
import { useTaskArtifactStore } from '../../../store/taskArtifacts';
import type {
  ArtifactAcceptance,
  ArtifactCheck,
  ArtifactVersion,
  LogicalArtifact,
} from '../../../gen/proto/domain/agent/agent_pb';

// Stable selector fallbacks: fresh [] literals make useSyncExternalStore see
// a new snapshot on every render check (React #185 update loop).
const EMPTY_ARTIFACT_LIST: readonly LogicalArtifact[] = [];
const EMPTY_VERSION_LIST: readonly ArtifactVersion[] = [];
const EMPTY_CHECK_LIST: readonly ArtifactCheck[] = [];
const EMPTY_ACCEPTANCE_LIST: readonly ArtifactAcceptance[] = [];

/**
 * TW-D3 document artifact work surface: immutable version reader,
 * selection feedback into the task composer, manual revision with
 * optimistic concurrency, structural/human checks and version-scoped
 * acceptance. Every action binds a concrete artifact/version id.
 */
export function DocumentArtifactPanel() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const conversationKey = useChatStore((s) => s.currentSessionKey);
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);

  const openArtifactId = useTaskArtifactStore((s) => s.openArtifactId);
  const closePanel = useTaskArtifactStore((s) => s.closePanel);
  const selectedVersionId = useTaskArtifactStore((s) => s.selectedVersionId);
  const selectVersion = useTaskArtifactStore((s) => s.selectVersion);
  const saveHumanEdit = useTaskArtifactStore((s) => s.saveHumanEdit);
  const quoteSelectionToComposer = useTaskArtifactStore((s) => s.quoteSelectionToComposer);
  const recordStructuralCheck = useTaskArtifactStore((s) => s.recordStructuralCheck);
  const recordHumanReview = useTaskArtifactStore((s) => s.recordHumanReview);
  const acceptCurrent = useTaskArtifactStore((s) => s.acceptCurrent);

  const artifact = useTaskArtifactStore((s) =>
    openArtifactId
      ? (s.artifactsByConversation[s.openConversationId ?? ''] ?? EMPTY_ARTIFACT_LIST).find(
          (item) => item.artifactId === openArtifactId,
        )
      : undefined,
  );
  const versions = useTaskArtifactStore((s) =>
    openArtifactId ? (s.versionsByArtifact[openArtifactId] ?? EMPTY_VERSION_LIST) : EMPTY_VERSION_LIST,
  );
  const body = useTaskArtifactStore((s) =>
    selectedVersionId ? (s.bodyByVersion[selectedVersionId] ?? '') : '',
  );
  const checks = useTaskArtifactStore((s) =>
    openArtifactId ? (s.checksByArtifact[openArtifactId] ?? EMPTY_CHECK_LIST) : EMPTY_CHECK_LIST,
  );
  const acceptances = useTaskArtifactStore((s) =>
    openArtifactId ? (s.acceptancesByArtifact[openArtifactId] ?? EMPTY_ACCEPTANCE_LIST) : EMPTY_ACCEPTANCE_LIST,
  );
  const pendingFeedback = useTaskArtifactStore((s) =>
    openArtifactId ? s.pendingFeedbackByArtifact[openArtifactId] : undefined,
  );

  const previewRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState('');

  useEffect(() => {
    setEditing(false);
    setError(null);
  }, [selectedVersionId, openArtifactId]);

  const selectedVersion = useMemo(
    () => versions.find((version) => version.versionId === selectedVersionId),
    [versions, selectedVersionId],
  );
  const isCurrent = Boolean(
    artifact && selectedVersion && artifact.currentVersionId === selectedVersion.versionId,
  );
  const versionChecks = useMemo(
    () => checks.filter((check) => check.versionId === selectedVersionId),
    [checks, selectedVersionId],
  );
  const currentAcceptance = acceptances.find(
    (item) => item.versionId === selectedVersionId && item.current,
  );

  const captureSelection = useCallback(() => {
    const selectedText = window.getSelection?.()?.toString().trim() ?? '';
    setSelection(selectedText);
  }, []);

  const handleQuoteSelection = useCallback(async () => {
    if (!openArtifactId || !selectedVersionId || !selection) return;
    setBusy(true);
    setError(null);
    try {
      await quoteSelectionToComposer({
        conversationId: conversationKey,
        artifactId: openArtifactId,
        baseVersionId: selectedVersionId,
        anchorText: selection,
        kind: 'selection',
        composerSeed: (text) => setComposerDraft(conversationKey, text),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [
    openArtifactId,
    selectedVersionId,
    selection,
    conversationKey,
    quoteSelectionToComposer,
    setComposerDraft,
  ]);

  const handleSaveEdit = useCallback(async () => {
    if (!openArtifactId || !selectedVersionId || !draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await saveHumanEdit({
        conversationId: conversationKey,
        artifactId: openArtifactId,
        expectedBaseVersionId: selectedVersionId,
        body: draft,
      });
      setEditing(false);
      await selectVersion(response.version!.versionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [openArtifactId, selectedVersionId, draft, conversationKey, saveHumanEdit, selectVersion]);

  const handleStructuralCheck = useCallback(async () => {
    if (!openArtifactId || !selectedVersionId) return;
    setBusy(true);
    setError(null);
    try {
      await recordStructuralCheck(openArtifactId, selectedVersionId, body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [openArtifactId, selectedVersionId, body, recordStructuralCheck]);

  const handleHumanReview = useCallback(
    async (passed: boolean) => {
      if (!openArtifactId || !selectedVersionId) return;
      setBusy(true);
      setError(null);
      try {
        await recordHumanReview(openArtifactId, selectedVersionId, passed);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [openArtifactId, selectedVersionId, recordHumanReview],
  );

  const handleAccept = useCallback(async () => {
    if (!openArtifactId || !selectedVersionId) return;
    setBusy(true);
    setError(null);
    try {
      await acceptCurrent(openArtifactId, selectedVersionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [openArtifactId, selectedVersionId, acceptCurrent]);

  const handleExport = useCallback(() => {
    if (!selectedVersion || !body) return;
    const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${artifact?.name ?? 'artifact'}-v${selectedVersion.seq}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [artifact, selectedVersion, body]);

  if (!openArtifactId || !artifact) return null;

  return (
    <Flexbox
      data-pt-artifact-panel
      data-pt-artifact-id={artifact.artifactId}
      data-pt-artifact-version={selectedVersionId ?? undefined}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 1200,
        boxShadow: '-8px 0 24px rgba(0,0,0,0.12)',
        borderLeft: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        width: 460,
        minWidth: 360,
        maxWidth: '60vw',
        padding: 16,
        overflowY: 'auto',
        gap: 12,
      }}
    >
      <Flexbox horizontal align="center" gap={8}>
        <strong data-pt-artifact-name style={{ flex: 1, fontSize: 14 }}>
          {artifact.name}
        </strong>
        <Select
          data-pt-artifact-version-select
          size="small"
          style={{ width: 120 }}
          value={selectedVersionId ?? undefined}
          onChange={(value) => void selectVersion(value)}
          options={versions.map((version) => ({
            value: version.versionId,
            label: `v${version.seq}`,
          }))}
        />
        <Button size="small" onClick={handleExport} data-pt-artifact-export>
          {t('chat.artifact.export')}
        </Button>
        <Button size="small" onClick={closePanel} data-pt-artifact-close>
          {t('chat.artifact.close')}
        </Button>
      </Flexbox>

      {!isCurrent && (
        <Tag color="default" data-pt-artifact-historical>
          {t('chat.artifact.historicalVersion')}
        </Tag>
      )}
      {currentAcceptance && (
        <Tag color="green" data-pt-artifact-accepted>
          {t('chat.artifact.acceptedVersion')}
        </Tag>
      )}
      {pendingFeedback && (
        <Tag color="gold" data-pt-artifact-feedback-pending>
          {t('chat.artifact.feedbackPending')}
        </Tag>
      )}

      {editing ? (
        <Flexbox gap={8}>
          <textarea
            data-pt-artifact-editor
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            style={{
              width: '100%',
              minHeight: 240,
              resize: 'vertical',
              border: `1px solid ${token.colorBorder}`,
              borderRadius: token.borderRadius,
              padding: 8,
              fontFamily: 'monospace',
              fontSize: 13,
            }}
          />
          <Flexbox horizontal gap={8} justify="flex-end">
            <Button size="small" onClick={() => setEditing(false)}>
              {t('chat.artifact.edit.cancel')}
            </Button>
            <Button
              size="small"
              type="primary"
              loading={busy}
              onClick={handleSaveEdit}
              data-pt-artifact-edit-save
            >
              {t('chat.artifact.edit.save')}
            </Button>
          </Flexbox>
        </Flexbox>
      ) : (
        <div
          ref={previewRef}
          data-pt-artifact-body
          onMouseUp={captureSelection}
          style={{
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadius,
            padding: 12,
            minHeight: 160,
            fontSize: 14,
          }}
        >
          <Markdown {...chatMarkdownProps} variant="chat" fontSize={14}>
            {body}
          </Markdown>
        </div>
      )}

      <Flexbox horizontal gap={8} wrap="wrap">
        {!editing && (
          <>
            <Button
              size="small"
              disabled={!selection || busy}
              onClick={() => void handleQuoteSelection()}
              data-pt-artifact-quote-selection
            >
              {t('chat.artifact.quoteSelection')}
            </Button>
            <Button
              size="small"
              disabled={busy || !isCurrent}
              onClick={() => {
                setDraft(body);
                setEditing(true);
              }}
              data-pt-artifact-edit-start
            >
              {t('chat.artifact.edit')}
            </Button>
          </>
        )}
      </Flexbox>

      {error && (
        <div data-pt-artifact-error style={{ color: token.colorError, fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Review area: checks are distinct facts; acceptance binds a version. */}
      <Flexbox
        gap={8}
        style={{
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          paddingTop: 12,
        }}
        data-pt-artifact-review
      >
        <strong style={{ fontSize: 13 }}>{t('chat.artifact.review')}</strong>
        <Flexbox horizontal gap={8} wrap="wrap">
          <Button
            size="small"
            disabled={busy}
            onClick={() => void handleStructuralCheck()}
            data-pt-artifact-check-structural
          >
            {t('chat.artifact.check.structural')}
          </Button>
          <Button
            size="small"
            disabled={busy}
            onClick={() => void handleHumanReview(true)}
            data-pt-artifact-check-human-pass
          >
            {t('chat.artifact.check.humanPass')}
          </Button>
          <Button
            size="small"
            danger
            disabled={busy}
            onClick={() => void handleHumanReview(false)}
            data-pt-artifact-check-human-fail
          >
            {t('chat.artifact.check.humanFail')}
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={busy || !isCurrent || Boolean(currentAcceptance)}
            onClick={() => void handleAccept()}
            data-pt-artifact-accept
          >
            {t('chat.artifact.accept')}
          </Button>
        </Flexbox>
        <Flexbox gap={4} data-pt-artifact-check-list>
          {versionChecks.map((check) => (
            <Tag
              key={check.checkId}
              data-pt-artifact-check={check.checkId}
              data-pt-artifact-check-result={
                check.result === 1 ? 'passed' : check.result === 2 ? 'failed' : 'unknown'
              }
              color={check.result === 1 ? 'green' : 'red'}
              style={{ margin: 0 }}
            >
              {check.checkType === 1 ? t('chat.artifact.check.structural') : t('chat.artifact.check.humanReview')}
              : {check.result === 1 ? t('chat.artifact.check.passed') : t('chat.artifact.check.failed')}
            </Tag>
          ))}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}
