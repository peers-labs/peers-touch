import { describe, expect, it } from "vitest";

import {
  buildMentionSet,
  findMentionTrigger,
  MENTION_ALL_TOKEN,
  textContainsMentionAll,
  type MentionCandidate,
} from "./chatMentions";

const members: MentionCandidate[] = [
  { actorPtid: "ptid:bob", displayName: "Bob", role: 1 },
  { actorPtid: "ptid:carol", displayName: "Carol Smith", role: 1 },
  { actorPtid: "ptid:bo", displayName: "Bo", role: 2 },
];

describe("findMentionTrigger", () => {
  it("returns the @query token at the caret", () => {
    expect(findMentionTrigger("hi @bo", 6)).toEqual({ start: 3, query: "bo" });
    expect(findMentionTrigger("hi @bob later", 7)).toEqual({
      start: 3,
      query: "bob",
    });
  });

  it("stays silent after a space or for an email-like prefix", () => {
    expect(findMentionTrigger("hi @bob ", 8)).toBeNull();
    expect(findMentionTrigger("mail@bob", 8)).toBeNull();
  });
});

describe("buildMentionSet", () => {
  it("resolves boundary tokens with UTF-16 offsets and keeps each actor once", () => {
    const text = "@Bob hi @Bob and @Carol Smith";
    const set = buildMentionSet(text, members, false);
    expect(set.mentionAll).toBe(false);
    expect(set.mentions).toEqual([
      { actorPtid: "ptid:bob", offset: 0, length: 4, display: "Bob" },
      {
        actorPtid: "ptid:carol",
        offset: 17,
        length: 12,
        display: "Carol Smith",
      },
    ]);
  });

  it("lets a longer name win over a short prefix name", () => {
    // "@Bob" must not be shadowed by "@Bo" because longer names match first.
    const set = buildMentionSet("@Bob", members, false);
    expect(set.mentions).toHaveLength(1);
    expect(set.mentions[0].actorPtid).toBe("ptid:bob");
  });

  it("ignores tokens glued to surrounding letters", () => {
    const set = buildMentionSet("x@Bob and @Bobx", members, false);
    expect(set.mentions).toEqual([]);
  });

  it("carries the mentionAll flag", () => {
    expect(
      buildMentionSet(`${MENTION_ALL_TOKEN} hi`, members, true).mentionAll,
    ).toBe(true);
  });
});

describe("textContainsMentionAll", () => {
  it("detects only boundary @all tokens", () => {
    expect(textContainsMentionAll(`${MENTION_ALL_TOKEN} morning`)).toBe(true);
    expect(textContainsMentionAll("call@all")).toBe(false);
    expect(textContainsMentionAll("wall street")).toBe(false);
  });
});
