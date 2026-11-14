import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatMentionText } from "./ChatMentionText";
import type { MessageMention } from "../../../services/im-service-contract";

describe("ChatMentionText", () => {
  it("renders in-range mentions as chips with @me attribution", () => {
    const mentions: MessageMention[] = [
      { actorPtid: "ptid:bob", offset: 3, length: 4, display: "Bob" },
      { actorPtid: "ptid:me", offset: 12, length: 3, display: "me" },
    ];
    const html = renderToStaticMarkup(
      <ChatMentionText
        text={"hi @Bob and @me"}
        mentions={mentions}
        currentUserPtid="ptid:me"
      />,
    );
    expect(html).toContain("data-chat-mention");
    expect(html).toContain('data-mention-actor="ptid:bob"');
    expect(html).toContain("data-mention-me=");
  });

  it("degrades invalid ranges after an edit to plain text", () => {
    const mentions: MessageMention[] = [
      { actorPtid: "ptid:bob", offset: 30, length: 4, display: "Bob" },
    ];
    const html = renderToStaticMarkup(
      <ChatMentionText text="short edited text" mentions={mentions} />,
    );
    expect(html).not.toContain("data-chat-mention");
  });

  it("highlights the @all token for incoming mention-all messages", () => {
    const own = renderToStaticMarkup(
      <ChatMentionText text="@all morning" mentionAll highlightAll={false} />,
    );
    expect(own).not.toContain("data-chat-mention");

    const incoming = renderToStaticMarkup(
      <ChatMentionText
        text="@all morning"
        mentionAll
        highlightAll
        currentUserPtid="ptid:me"
      />,
    );
    expect(incoming).toContain("data-chat-mention");
    expect(incoming).toContain("@all");
  });
});
