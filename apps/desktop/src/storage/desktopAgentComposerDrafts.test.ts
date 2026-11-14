import { describe, expect, it } from 'vitest';

import type { AgentAttachmentRefInput } from '../services/desktop_api';
import {
  buildAgentComposerDraftDocument,
  parseAgentAttachmentRef,
  parseAgentComposerDraftDocument,
} from './desktopAgentComposerDrafts';

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);

function makeRef(overrides: Partial<AgentAttachmentRefInput> = {}): AgentAttachmentRefInput {
  return {
    attachment_id: 'att-1',
    object_ref: 'oss://bucket/object-1',
    mime_type: 'application/pdf',
    size_bytes: 128,
    checksum: 'sha256:abc',
    filename: 'brief.pdf',
    authorization_scope: 'conversation',
    expires_at: '',
    extracted_content_ref: '',
    ...overrides,
  };
}

describe('parseAgentAttachmentRef', () => {
  it('accepts a complete unexpired ref', () => {
    const ref = parseAgentAttachmentRef(
      makeRef({ expires_at: new Date(NOW + 60_000).toISOString() }),
      NOW,
    );
    expect(ref?.attachment_id).toBe('att-1');
  });

  it('rejects missing or mistyped fields', () => {
    expect(parseAgentAttachmentRef(null, NOW)).toBeNull();
    expect(parseAgentAttachmentRef({ ...makeRef(), object_ref: 42 }, NOW)).toBeNull();
    expect(parseAgentAttachmentRef({ ...makeRef(), size_bytes: '8' }, NOW)).toBeNull();
    expect(parseAgentAttachmentRef({ ...makeRef(), size_bytes: -1 }, NOW)).toBeNull();
    const incomplete = makeRef() as Partial<AgentAttachmentRefInput>;
    delete incomplete.checksum;
    expect(parseAgentAttachmentRef(incomplete, NOW)).toBeNull();
  });

  it('drops expired grants but keeps unparseable expiry strings', () => {
    const expired = parseAgentAttachmentRef(
      makeRef({ expires_at: new Date(NOW - 1_000).toISOString() }),
      NOW,
    );
    expect(expired).toBeNull();
    const weird = parseAgentAttachmentRef(makeRef({ expires_at: 'not-a-date' }), NOW);
    expect(weird?.attachment_id).toBe('att-1');
  });
});

describe('parseAgentComposerDraftDocument', () => {
  it('rejects foreign schemas and non-objects', () => {
    expect(parseAgentComposerDraftDocument(null)).toBeNull();
    expect(parseAgentComposerDraftDocument('{}')).toBeNull();
    expect(parseAgentComposerDraftDocument({ schema: 2, drafts: {} })).toBeNull();
    expect(parseAgentComposerDraftDocument({ schema: 1, drafts: [] })).toBeNull();
  });

  it('drops bad entries and individual bad refs while keeping the rest', () => {
    const parsed = parseAgentComposerDraftDocument({
      schema: 1,
      drafts: {
        good: {
          text: 'hello',
          attachments: [makeRef(), { ...makeRef(), object_ref: 1 }],
          updatedAt: NOW,
        },
        empty: { text: '', attachments: [], updatedAt: NOW },
        badText: { text: 1, attachments: [], updatedAt: NOW },
        badTime: { text: 'x', attachments: [], updatedAt: 'yesterday' },
      },
    }, NOW);
    expect(parsed?.drafts.good?.text).toBe('hello');
    expect(parsed?.drafts.good?.attachments).toHaveLength(1);
    expect(parsed?.drafts.empty).toBeUndefined();
    expect(parsed?.drafts.badText).toBeUndefined();
    expect(parsed?.drafts.badTime).toBeUndefined();
  });

  it('drops oversized draft text', () => {
    const parsed = parseAgentComposerDraftDocument({
      schema: 1,
      drafts: {
        large: { text: 'x'.repeat(16 * 1024 + 1), attachments: [], updatedAt: NOW },
      },
    }, NOW);
    expect(parsed?.drafts.large).toBeUndefined();
  });
});

describe('buildAgentComposerDraftDocument', () => {
  it('returns null when both tables are empty', () => {
    expect(buildAgentComposerDraftDocument({ texts: {}, attachments: {} }, null, NOW))
      .toBeNull();
  });

  it('builds one entry per session key from text and attachment tables', () => {
    const document = buildAgentComposerDraftDocument({
      texts: { convA: 'question' },
      attachments: { convB: [makeRef({ attachment_id: 'att-2' })] },
    }, null, NOW);
    expect(document?.schema).toBe(1);
    expect(document?.drafts.convA).toEqual({
      text: 'question',
      attachments: [],
      updatedAt: NOW,
    });
    expect(document?.drafts.convB.attachments[0]?.attachment_id).toBe('att-2');
  });

  it('preserves updatedAt for unchanged content and stamps changed content', () => {
    const first = buildAgentComposerDraftDocument(
      { texts: { convA: 'one' }, attachments: {} },
      null,
      NOW,
    )!;
    const second = buildAgentComposerDraftDocument(
      { texts: { convA: 'one' }, attachments: {} },
      first,
      NOW + 5_000,
    )!;
    expect(second.drafts.convA.updatedAt).toBe(NOW);
    const third = buildAgentComposerDraftDocument(
      { texts: { convA: 'two' }, attachments: {} },
      second,
      NOW + 5_000,
    )!;
    expect(third.drafts.convA.updatedAt).toBe(NOW + 5_000);
  });

  it('evicts least-recently-updated drafts past the entry cap', () => {
    const texts: Record<string, string> = {};
    for (let index = 0; index < 105; index += 1) {
      texts[`conv-${index}`] = `draft ${index}`;
    }
    const document = buildAgentComposerDraftDocument(
      { texts, attachments: {} },
      null,
      NOW,
    )!;
    const keys = Object.keys(document.drafts);
    expect(keys).toHaveLength(100);
    expect(document.drafts['conv-0']).toBeUndefined();
    expect(document.drafts['conv-104']).toBeDefined();
  });

  it('skips oversized text and caps attachments per draft', () => {
    const many = Array.from({ length: 12 }, (_, index) => makeRef({
      attachment_id: `att-${index}`,
      object_ref: `oss://o/${index}`,
    }));
    const document = buildAgentComposerDraftDocument({
      texts: {
        convA: 'x'.repeat(16 * 1024 + 1),
        convB: '',
        convC: 'with refs',
      },
      attachments: { convA: many, convB: [makeRef()], convC: many },
    }, null, NOW)!;
    expect(document.drafts.convA).toBeUndefined();
    expect(document.drafts.convB.attachments).toHaveLength(1);
    expect(document.drafts.convC.attachments).toHaveLength(10);
  });
});
