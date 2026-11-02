import { useCallback, useEffect, useState } from 'react';
import { Button, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../../store/chat';
import { useChatStore } from '../../../store/chat';
import { useTaskArtifactStore } from '../../../store/taskArtifacts';
import type { LogicalArtifact } from '../../../gen/proto/domain/agent/agent_pb';

interface DocumentArtifactActionsProps {
  message: ChatMessage;
}

/**
 * TW-D3 entry point: promote a completed assistant message's real bytes into
 * the immutable artifact system — either as a new logical artifact or as a
 * new version of an existing one (consuming any recorded selection feedback).
 * Nothing is parsed from code blocks; bytes come from the Station message.
 */
export function DocumentArtifactActions({ message }: DocumentArtifactActionsProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const conversationId = useChatStore((s) => s.currentSessionKey);
  const messages = useChatStore((s) => s.messages);
  const claimedIds = useTaskArtifactStore(
    (s) => s.claimedMessageIdsByConversation[conversationId] ?? [],
  );
  const loadArtifacts = useTaskArtifactStore((s) => s.loadArtifacts);
  const claimedMessageIds = useTaskArtifactStore((s) => s.claimedMessageIds);
  const claimFromMessage = useTaskArtifactStore((s) => s.claimFromMessage);
  const openPanel = useTaskArtifactStore((s) => s.openPanel);
  const [artifacts, setArtifacts] = useState<LogicalArtifact[]>([]);
  const [claimedArtifactId, setClaimedArtifactId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await loadArtifacts(conversationId);
      const ids = await claimedMessageIds(conversationId);
      // Find which artifact owns a version sourced from this message.
      let ownerId: string | null = null;
      if (ids.has(message.id)) {
        const versions = useTaskArtifactStore.getState().versionsByArtifact;
        ownerId = list.find((artifact) =>
          (versions[artifact.artifactId] ?? []).some(
            (version) => version.sourceMessageId === message.id,
          ),
        )?.artifactId ?? null;
      }
      if (!cancelled) {
        setArtifacts(list);
        setClaimedArtifactId(ownerId);
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [conversationId, message.id, loadArtifacts, claimedMessageIds, claimedIds.length]);

  const claim = useCallback(
    async (artifactId?: string, expectedBaseVersionId?: string) => {
      if (!message.turnId) return;
      // Adoption is recorded per version: collect the admitted material
      // object refs of every user input merged into this producing turn
      // (TW-D2 amendments can attach more than one user message).
      const adoptedAttachmentRefs = Array.from(new Set(
        messages
          .filter((item) => item.role === 'user' && item.turnId === message.turnId)
          .flatMap((item) => item.attachments ?? [])
          .map((attachment) => attachment.attachment?.object_ref ?? attachment.cid)
          .filter((ref): ref is string => Boolean(ref)),
      ));
      setBusyId(artifactId ?? 'new');
      setError(null);
      try {
        const response = await claimFromMessage({
          conversationId,
          turnId: message.turnId,
          messageId: message.id,
          artifactId,
          expectedBaseVersionId,
          adoptedAttachmentRefs,
        });
        await openPanel(conversationId, response.artifact!.artifactId, response.version!.versionId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyId(null);
      }
    },
    [claimFromMessage, conversationId, message.id, message.turnId, messages, openPanel],
  );

  if (message.loading || message.terminalStatus === 'failed') return null;

  // A message already claimed as a version only gets an "open artifact" entry.
  if (claimedArtifactId) {
    return (
      <Flexbox horizontal gap={6} style={{ marginTop: 6 }}>
        <Button
          size="small"
          onClick={() => void openPanel(conversationId, claimedArtifactId)}
          data-pt-artifact-open={claimedArtifactId}
        >
          {t('chat.artifact.open')}
        </Button>
      </Flexbox>
    );
  }

  return (
    <Flexbox
      horizontal
      gap={6}
      wrap="wrap"
      data-pt-artifact-actions={message.id}
      style={{ marginTop: 6 }}
    >
      <Button
        size="small"
        loading={busyId === 'new'}
        onClick={() => void claim()}
        data-pt-artifact-save-new
      >
        {t('chat.artifact.saveAs')}
      </Button>
      {artifacts.map((artifact) => (
        <Button
          key={artifact.artifactId}
          size="small"
          loading={busyId === artifact.artifactId}
          onClick={() => void claim(artifact.artifactId, artifact.currentVersionId)}
          data-pt-artifact-save-version={artifact.artifactId}
        >
          {t('chat.artifact.saveAsVersion', { name: artifact.name })}
        </Button>
      ))}
      {error && (
        <span style={{ color: token.colorError, fontSize: 12 }} data-pt-artifact-save-error>
          {error}
        </span>
      )}
    </Flexbox>
  );
}
