import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ExternalLink, FilePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '../../../store/chat';
import { useChatStore } from '../../../store/chat';
import { useTaskArtifactStore } from '../../../store/taskArtifacts';
import { notifyError } from '../../../ui/feedback';
import type { LogicalArtifact } from '../../../gen/proto/domain/agent/agent_pb';
import type { MessageActionDef } from './types';

// Stable fallback for selectors: a fresh [] on every getSnapshot call makes
// useSyncExternalStore detect a changed snapshot forever (React #185 loop).
const EMPTY_STRING_LIST: readonly string[] = [];

/**
 * TW-D3 entry point moved into the message "more" menu: promote a completed
 * assistant message's real bytes into the immutable artifact system — either
 * as a new logical artifact or as a new version of an existing one (consuming
 * any recorded selection feedback). Nothing is parsed from code blocks; bytes
 * come from the Station message. Returns menu entries (empty when the message
 * cannot back an artifact) so the action bar stays a single compact row.
 */
export function useDocumentArtifactActions(message: ChatMessage): MessageActionDef[] {
  const sourceMessageId = message.contentMessageId ?? message.id;
  const { t } = useTranslation('chat');
  const conversationId = useChatStore((s) => s.currentSessionKey);
  const messages = useChatStore((s) => s.messages);
  const claimedIds = useTaskArtifactStore(
    (s) => s.claimedMessageIdsByConversation[conversationId] ?? EMPTY_STRING_LIST,
  );
  const loadArtifacts = useTaskArtifactStore((s) => s.loadArtifacts);
  const claimedMessageIds = useTaskArtifactStore((s) => s.claimedMessageIds);
  const claimFromMessage = useTaskArtifactStore((s) => s.claimFromMessage);
  const openPanel = useTaskArtifactStore((s) => s.openPanel);
  const [artifacts, setArtifacts] = useState<LogicalArtifact[]>([]);
  const [claimedArtifactId, setClaimedArtifactId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await loadArtifacts(conversationId);
      const ids = await claimedMessageIds(conversationId);
      // Find which artifact owns a version sourced from this message.
      let ownerId: string | null = null;
      if (ids.has(sourceMessageId)) {
        const versions = useTaskArtifactStore.getState().versionsByArtifact;
        ownerId = list.find((artifact) =>
          (versions[artifact.artifactId] ?? []).some(
            (version) => version.sourceMessageId === sourceMessageId,
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
  }, [conversationId, sourceMessageId, loadArtifacts, claimedMessageIds, claimedIds.length]);

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
      try {
        const response = await claimFromMessage({
          conversationId,
          turnId: message.turnId,
          messageId: sourceMessageId,
          artifactId,
          expectedBaseVersionId,
          adoptedAttachmentRefs,
        });
        await openPanel(conversationId, response.artifact!.artifactId, response.version!.versionId);
      } catch (cause) {
        notifyError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyId(null);
      }
    },
    [claimFromMessage, conversationId, sourceMessageId, message.turnId, messages, openPanel],
  );

  return useMemo<MessageActionDef[]>(() => {
    if (message.loading || message.terminalStatus === 'failed') return [];

    // An empty assistant leg (e.g. the tool-call leg of a turn) cannot back
    // an artifact version; claiming it only yields an invalid empty body.
    if (!claimedArtifactId && !String(message.content ?? '').trim()) return [];

    // A message already claimed as a version only gets an "open artifact" entry.
    if (claimedArtifactId) {
      return [
        {
          key: 'openArtifact',
          label: t('chat.artifact.open'),
          icon: ExternalLink,
          probe: { 'pt-artifact-open': claimedArtifactId },
          onClick: () => void openPanel(conversationId, claimedArtifactId),
        },
      ];
    }

    const saveLabel = t('chat.artifact.saveAs');
    return [
      {
        key: 'saveArtifact',
        label: saveLabel,
        icon: Archive,
        disabled: busyId === 'new',
        probe: { 'pt-artifact-save-new': '' },
        onClick: () => void claim(),
      },
      ...artifacts.map<MessageActionDef>((artifact) => ({
        key: `saveArtifactVersion-${artifact.artifactId}`,
        label: t('chat.artifact.saveAsVersion', { name: artifact.name }),
        icon: FilePlus,
        disabled: busyId === artifact.artifactId,
        probe: { 'pt-artifact-save-version': artifact.artifactId },
        onClick: () => void claim(artifact.artifactId, artifact.currentVersionId),
      })),
    ];
  }, [message.loading, message.terminalStatus, message.content, claimedArtifactId, artifacts, busyId, claim, openPanel, conversationId, t]);
}
