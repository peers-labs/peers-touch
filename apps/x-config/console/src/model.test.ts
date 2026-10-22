import { describe, expect, it } from "vitest";
import { catalogDiff, publicationState } from "./model";
import { emptyCatalog, type Publication } from "./types";

describe("x config console model", () => {
  it("keeps removed endpoint semantics explicit", () => {
    const before = emptyCatalog();
    before.endpoints.push({
      seed_id: "relay-home",
      kind: "relay",
      display_name: "Home Relay",
      connection_material_base64: "AA==",
      regions: ["global"],
    });
    const changes = catalogDiff(before, emptyCatalog());
    expect(changes).toEqual([
      {
        id: "endpoint:relay-home",
        label: "Home Relay",
        kind: "removed",
      },
    ]);
  });

  it("projects the publication bound to the current catalog digest", () => {
    const publications: Publication[] = [{
      publication_id: "publication-00000000000000000001",
      channel: "stable",
      sequence: 1,
      source_revision: "revision-1",
      content_sha256: "a".repeat(64),
      signing_key_id: "publisher-1",
      statement_sha256: "b".repeat(64),
      envelope_sha256: "c".repeat(64),
      published_by: "github:42",
      published_at: "2026-10-18T00:00:00Z",
      expires_at: "2026-10-19T00:00:00Z",
      repository_revision: "revision-2",
      catalog: emptyCatalog(),
    }];
    expect(publicationState(publications, "a".repeat(64))).toBe("published");
    expect(publicationState(publications, "b".repeat(64))).toBe("clean");
  });
});
