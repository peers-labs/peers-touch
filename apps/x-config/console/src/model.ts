import type { Catalog, Publication } from "./types";

export type DiffItem = {
  id: string;
  label: string;
  kind: "added" | "modified" | "removed";
};

export function catalogDiff(before: Catalog, after: Catalog): DiffItem[] {
  const previous = flatten(before);
  const next = flatten(after);
  const changes: DiffItem[] = [];
  for (const [id, value] of next) {
    const prior = previous.get(id);
    if (!prior) {
      changes.push({ id, label: value.label, kind: "added" });
    } else if (JSON.stringify(prior.value) !== JSON.stringify(value.value)) {
      changes.push({ id, label: value.label, kind: "modified" });
    }
  }
  for (const [id, value] of previous) {
    if (!next.has(id)) {
      changes.push({
        id,
        label: value.label,
        kind: "removed",
      });
    }
  }
  return changes.sort((left, right) => left.id.localeCompare(right.id));
}

export function publicationState(
  publications: Publication[],
  contentSHA256: string,
): "clean" | "published" {
  const current = publications.find(
    (publication) => publication.content_sha256 === contentSHA256,
  );
  if (!current) return "clean";
  return "published";
}

function flatten(catalog: Catalog) {
  const values = new Map<string, { label: string; value: unknown }>();
  catalog.endpoints.forEach((endpoint) => {
    values.set(`endpoint:${endpoint.seed_id}`, {
      label: endpoint.display_name,
      value: endpoint,
    });
  });
  catalog.releases.forEach((release) => {
    values.set(`release:${release.release_id}`, {
      label: release.release_id,
      value: release,
    });
  });
  return values;
}
