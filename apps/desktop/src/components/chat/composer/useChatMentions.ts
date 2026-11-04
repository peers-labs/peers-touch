import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Modal } from "antd";
import { useTranslation } from "react-i18next";

import { resolveActorIdentity } from "../../../store/socialProfileProjection";
import { useSocialChatStore } from "../../../store/socialChat";
import { MemberRole } from "../../../gen/proto/domain/chat/conversation_pb";
import type { MessageMentionSet } from "../../../services/im-service-contract";
import {
  buildMentionSet,
  findMentionTrigger,
  MENTION_ALL_TOKEN,
  textContainsMentionAll,
  type MentionCandidate,
} from "./chatMentions";

const MENTION_PICKER_LIMIT = 8;
/** Groups at or above this size require an explicit @all confirmation. */
export const MENTION_ALL_CONFIRM_THRESHOLD = 20;
/** Client-side @all rate limit window. */
const MENTION_ALL_COOLDOWN_MS = 60_000;

export interface MentionPickerRow {
  key: string;
  kind: "all" | "member";
  actorPtid: string;
  displayName: string;
  role: number;
}

export interface ChatMentionsApi {
  open: boolean;
  rows: MentionPickerRow[];
  highlightedIndex: number;
  /** Recompute the active trigger from the textarea caret (call on change/click/keyup). */
  syncTrigger: () => void;
  close: () => void;
  setHighlightedIndex: (index: number) => void;
  /** Intercept picker navigation keys; returns true when handled. */
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  selectHighlighted: () => void;
  insertMention: (row: MentionPickerRow) => void;
  /** Resolve the ciphertext mention set for `text` and enforce the @all cooldown. */
  buildSendSet: (text: string) => {
    mentionSet?: MessageMentionSet;
    rateLimited: boolean;
  };
}

interface UseChatMentionsArgs {
  enabled: boolean;
  conversationId: string;
  commitValue: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  getValue: () => string;
}

function mentionAllCooldownKey(conversationId: string): string {
  return `peers-touch:chat:mention-all-cooldown:${conversationId}`;
}

export function useChatMentions({
  enabled,
  conversationId,
  commitValue,
  textareaRef,
  getValue,
}: UseChatMentionsArgs): ChatMentionsApi {
  const { t } = useTranslation("chat");
  const [trigger, setTrigger] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const armedAllRef = useRef(false);

  const members = useSocialChatStore(
    (state) => state.groupMembers[conversationId],
  );
  const peerProfiles = useSocialChatStore((state) => state.peerProfiles);
  const sessions = useSocialChatStore((state) => state.sessions);
  const currentUserProfile = useSocialChatStore(
    (state) => state.currentUserProfile,
  );
  const currentUserPtid = useSocialChatStore((state) => state.currentUserPtid);

  const candidates = useMemo<MentionCandidate[]>(() => {
    if (!enabled) return [];
    return (members ?? [])
      .filter((member) => member.ptid !== currentUserPtid)
      .map((member) => {
        const identity = resolveActorIdentity({
          ptid: member.ptid,
          currentUserPtid,
          currentUserProfile,
          peerProfiles,
          sessions,
          nickname: member.nickname ?? "",
        });
        return {
          actorPtid: member.ptid,
          displayName: identity.displayName,
          role: member.role,
        };
      })
      .filter((candidate) => candidate.displayName.trim().length > 0);
  }, [
    currentUserPtid,
    currentUserProfile,
    enabled,
    members,
    peerProfiles,
    sessions,
  ]);

  const myRole = useMemo(() => {
    if (!currentUserPtid) return MemberRole.UNSPECIFIED;
    return (
      members?.find((member) => member.ptid === currentUserPtid)?.role ??
      MemberRole.UNSPECIFIED
    );
  }, [currentUserPtid, members]);
  const canMentionAll =
    enabled && (myRole === MemberRole.OWNER || myRole === MemberRole.ADMIN);

  const rows = useMemo<MentionPickerRow[]>(() => {
    if (!enabled || !trigger) return [];
    const query = trigger.query.trim().toLowerCase();
    const result: MentionPickerRow[] = [];
    if (canMentionAll && ("all".startsWith(query) || query === "")) {
      result.push({
        key: "__all__",
        kind: "all",
        actorPtid: "",
        displayName: t("chat.social.mentions.everyone"),
        role: 0,
      });
    }
    const matched = candidates
      .filter((candidate) =>
        candidate.displayName.toLowerCase().includes(query),
      )
      .slice(0, MENTION_PICKER_LIMIT)
      .map((candidate): MentionPickerRow => ({
        key: candidate.actorPtid,
        kind: "member",
        actorPtid: candidate.actorPtid,
        displayName: candidate.displayName,
        role: candidate.role,
      }));
    return [...result, ...matched].slice(0, MENTION_PICKER_LIMIT);
  }, [canMentionAll, candidates, enabled, t, trigger]);

  const open = enabled && trigger !== null && rows.length > 0;

  const syncTrigger = useCallback(() => {
    if (!enabled) {
      setTrigger(null);
      return;
    }
    const textarea = textareaRef.current;
    const text = getValue();
    const next = textarea
      ? findMentionTrigger(text, textarea.selectionStart ?? text.length)
      : null;
    setTrigger((current) => {
      if (current?.start !== next?.start || current?.query !== next?.query) {
        setHighlightedIndex(0);
      }
      return next;
    });
  }, [enabled, getValue, textareaRef]);

  const close = useCallback(() => setTrigger(null), []);
  const setHighlighted = useCallback(
    (index: number) => setHighlightedIndex(index),
    [],
  );

  const insertToken = useCallback(
    (token: string) => {
      const textarea = textareaRef.current;
      if (!textarea || !trigger) return;
      const text = getValue();
      const caret = textarea.selectionStart ?? text.length;
      const before = text.slice(0, trigger.start);
      const after = text.slice(caret);
      const nextText = `${before}${token} ${after.startsWith(" ") ? "" : " "}${after}`;
      commitValue(nextText);
      const nextCaret = before.length + token.length + 1;
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });
      setTrigger(null);
    },
    [commitValue, getValue, textareaRef, trigger],
  );

  const insertMention = useCallback(
    (row: MentionPickerRow) => {
      if (row.kind === "all") {
        const memberCount = members?.length ?? 0;
        const apply = () => {
          armedAllRef.current = true;
          insertToken(MENTION_ALL_TOKEN);
        };
        if (memberCount >= MENTION_ALL_CONFIRM_THRESHOLD) {
          Modal.confirm({
            title: t("chat.social.mentions.everyoneConfirmTitle"),
            content: t("chat.social.mentions.everyoneConfirmBody", {
              count: memberCount,
            }),
            okText: t("chat.social.mentions.everyoneConfirmOk"),
            cancelText: t("chat.social.messageArea.cancel"),
            onOk: apply,
          });
          return;
        }
        apply();
        return;
      }
      insertToken(`@${row.displayName}`);
    },
    [insertToken, members, t],
  );

  const selectHighlighted = useCallback(() => {
    const row = rows[highlightedIndex];
    if (row) insertMention(row);
  }, [highlightedIndex, insertMention, rows]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!open) return false;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((index) => (index + 1) % rows.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((index) => (index - 1 + rows.length) % rows.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectHighlighted();
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setTrigger(null);
        return true;
      }
      return false;
    },
    [open, rows.length, selectHighlighted],
  );

  const buildSendSet = useCallback(
    (
      text: string,
    ): {
      mentionSet?: MessageMentionSet;
      rateLimited: boolean;
    } => {
      if (!enabled) return { rateLimited: false };
      const mentionAll = armedAllRef.current && textContainsMentionAll(text);
      if (mentionAll) {
        let lastSent = 0;
        try {
          lastSent = Number(
            window.localStorage.getItem(
              mentionAllCooldownKey(conversationId),
            ) ?? 0,
          );
        } catch {
          lastSent = 0;
        }
        if (Date.now() - lastSent < MENTION_ALL_COOLDOWN_MS) {
          return { rateLimited: true };
        }
      }
      const set = buildMentionSet(text, candidates, mentionAll);
      const hasMentions = set.mentions.length > 0 || set.mentionAll;
      if (set.mentionAll) {
        try {
          window.localStorage.setItem(
            mentionAllCooldownKey(conversationId),
            String(Date.now()),
          );
        } catch {
          // Best-effort client throttle; the authority gate lives server-side.
        }
        armedAllRef.current = false;
      }
      return { mentionSet: hasMentions ? set : undefined, rateLimited: false };
    },
    [candidates, conversationId, enabled],
  );

  // Reset the armed @all when switching conversations.
  const conversationRef = useRef(conversationId);
  useEffect(() => {
    if (conversationRef.current === conversationId) return;
    conversationRef.current = conversationId;
    armedAllRef.current = false;
  }, [conversationId]);

  return {
    open,
    rows,
    highlightedIndex,
    syncTrigger,
    close,
    setHighlightedIndex: setHighlighted,
    handleKeyDown,
    selectHighlighted,
    insertMention,
    buildSendSet,
  };
}
