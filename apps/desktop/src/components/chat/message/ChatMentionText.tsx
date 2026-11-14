import { Fragment, type ReactNode } from "react";
import { theme } from "antd";

import type { MessageMention } from "../../../services/im-service-contract";
import { MENTION_ALL_TOKEN } from "../composer/chatMentions";

interface ChatMentionTextProps {
  text: string;
  mentions?: MessageMention[];
  mentionAll?: boolean;
  /** True when the message was sent by someone else (an @all then targets the reader). */
  highlightAll?: boolean;
  currentUserPtid?: string | null;
}

interface ResolvedMention {
  start: number;
  length: number;
  actorPtid: string;
  self: boolean;
}

/**
 * Render message text with in-ciphertext @mentions as chips. Ranges are
 * re-validated against the displayed text because edited messages keep the
 * original mention metadata; invalid ranges render as ordinary text instead
 * of highlighting the wrong span.
 */
export function ChatMentionText({
  text,
  mentions,
  mentionAll,
  highlightAll,
  currentUserPtid,
}: ChatMentionTextProps) {
  const { token } = theme.useToken();

  const resolved: ResolvedMention[] = (mentions ?? [])
    .filter((mention) => {
      const end = mention.offset + mention.length;
      return (
        mention.length > 0 &&
        mention.actorPtid.startsWith("ptid:") &&
        end <= text.length &&
        text.slice(mention.offset, mention.offset + 1) === "@"
      );
    })
    .map((mention) => ({
      start: mention.offset,
      length: mention.length,
      actorPtid: mention.actorPtid,
      self: Boolean(currentUserPtid && mention.actorPtid === currentUserPtid),
    }))
    .sort((a, b) => a.start - b.start)
    // Deduplicate/skip overlapping ranges after edit shifts.
    .filter(
      (mention, index, list) =>
        index === 0 ||
        mention.start >= list[index - 1].start + list[index - 1].length,
    );

  const allRange = mentionAll && highlightAll ? findAllTokenRange(text) : null;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  const appendPlain = (key: string, segment: string) => {
    if (segment) nodes.push(<Fragment key={key}>{segment}</Fragment>);
  };
  const appendChip = (
    key: string,
    segment: string,
    self: boolean,
    actor?: string,
  ) => {
    nodes.push(
      <span
        key={key}
        data-chat-mention
        data-mention-actor={actor}
        data-mention-me={self || undefined}
        style={{
          borderRadius: 4,
          padding: "0 4px",
          fontWeight: self ? 600 : 500,
          background: self ? token.colorWarningBg : token.colorPrimaryBg,
          color: self ? token.colorWarning : token.colorPrimary,
        }}
      >
        {segment}
      </span>,
    );
  };

  const all = allRange
    ? [
        {
          start: allRange.start,
          length: allRange.length,
          actorPtid: "",
          self: true,
        },
      ]
    : [];
  const combined = [...resolved, ...all]
    .sort((a, b) => a.start - b.start)
    .filter(
      (mention, index, list) =>
        index === 0 ||
        mention.start >= list[index - 1].start + list[index - 1].length,
    );

  combined.forEach((mention, index) => {
    appendPlain(`t-${index}`, text.slice(cursor, mention.start));
    appendChip(
      `m-${index}`,
      text.slice(mention.start, mention.start + mention.length),
      mention.self,
      mention.actorPtid || undefined,
    );
    cursor = mention.start + mention.length;
  });
  appendPlain("t-end", text.slice(cursor));

  return <>{nodes}</>;
}

function findAllTokenRange(
  text: string,
): { start: number; length: number } | null {
  let cursor = 0;
  while (cursor <= text.length - MENTION_ALL_TOKEN.length) {
    const at = text.indexOf(MENTION_ALL_TOKEN, cursor);
    if (at < 0) return null;
    const end = at + MENTION_ALL_TOKEN.length;
    const beforeOk = at === 0 || /\s/.test(text[at - 1]);
    const afterOk = end >= text.length || /[^\p{L}\p{N}]/u.test(text[end]);
    if (beforeOk && afterOk)
      return { start: at, length: MENTION_ALL_TOKEN.length };
    cursor = at + 1;
  }
  return null;
}
