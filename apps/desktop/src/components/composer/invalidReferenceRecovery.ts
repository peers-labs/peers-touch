export type RetiredInlineReferenceKind =
  | 'file'
  | 'folder'
  | 'url'
  | 'diff'
  | 'staged'
  | 'git';

export interface RetiredInlineReference {
  kind: RetiredInlineReferenceKind;
  raw: string;
  start: number;
  end: number;
}

export interface InvalidReferenceRemovalResult {
  draft: string;
  removedCount: number;
}

const REFERENCE_PATTERNS: ReadonlyArray<{
  kind: RetiredInlineReferenceKind;
  pattern: RegExp;
}> = [
  { kind: 'file', pattern: /@file:\S*/gu },
  { kind: 'folder', pattern: /@folder:\S*/gu },
  { kind: 'url', pattern: /@url:\S*/gu },
  { kind: 'diff', pattern: /@diff\b/gu },
  { kind: 'staged', pattern: /@staged\b/gu },
  { kind: 'git', pattern: /@git:\S*/gu },
];

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export function findRetiredInlineReferences(
  draft: string,
): RetiredInlineReference[] {
  const references = REFERENCE_PATTERNS.flatMap(({ kind, pattern }) =>
    Array.from(draft.matchAll(pattern), (match) => {
      const start = match.index ?? 0;
      return {
        kind,
        raw: match[0],
        start,
        end: start + match[0].length,
      };
    }),
  );
  return references.sort((left, right) => left.start - right.start);
}

export async function hashInlineReference(raw: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(raw),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function removeRejectedInlineReferences(
  draft: string,
  referenceKind: string,
  referenceHash: string,
): Promise<InvalidReferenceRemovalResult> {
  if (
    !REFERENCE_PATTERNS.some(({ kind }) => kind === referenceKind)
    || !SHA256_HEX_PATTERN.test(referenceHash)
  ) {
    return { draft, removedCount: 0 };
  }

  const references = findRetiredInlineReferences(draft).filter(
    (reference) => reference.kind === referenceKind,
  );
  const hashedReferences = await Promise.all(
    references.map(async (reference) => ({
      ...reference,
      hash: await hashInlineReference(reference.raw),
    })),
  );
  const matches = hashedReferences.filter(
    (reference) => reference.hash === referenceHash,
  );
  if (matches.length === 0) {
    return { draft, removedCount: 0 };
  }

  const nextDraft = [...matches]
    .sort((left, right) => right.start - left.start)
    .reduce((value, reference) => {
      let start = reference.start;
      let end = reference.end;
      const before = value[start - 1];
      const after = value[end];
      if (
        (start === 0 || before === '\n' || before === '\r')
        && (after === ' ' || after === '\t')
      ) {
        end += 1;
      } else if (
        (before === ' ' || before === '\t')
        && (after === ' ' || after === '\t')
      ) {
        end += 1;
      } else if (
        end === value.length
        && (before === ' ' || before === '\t')
      ) {
        start -= 1;
      }
      return value.slice(0, start) + value.slice(end);
    }, draft);
  return { draft: nextDraft, removedCount: matches.length };
}
