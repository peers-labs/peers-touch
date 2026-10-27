import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(new URL('./KnowledgeSettings.tsx', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../../modules/knowledge.ts', import.meta.url), 'utf8');
const moduleIndexSource = readFileSync(new URL('../../modules/index.ts', import.meta.url), 'utf8');

describe('Knowledge settings contract', () => {
  it('registers Knowledge as a selected-only Settings module', () => {
    expect(moduleSource).toContain("id: 'knowledge'");
    expect(moduleSource).toContain('KnowledgeSettings');
    expect(moduleSource).toContain("cache: 'selected-only'");
    expect(moduleIndexSource).toContain("import './knowledge';");
  });

  it('uses Station descriptor and content APIs without local persistence', () => {
    expect(componentSource).toContain('knowledgeService.createDocument');
    expect(componentSource).toContain('knowledgeService.updateDocument');
    expect(componentSource).toContain('knowledgeService.readContent');
    expect(componentSource).toContain('knowledgeService.tombstone');
    expect(componentSource).not.toContain('localStorage');
    expect(componentSource).not.toContain('GitBranch');
  });

  it('keeps list, create, detail and reader mutually exclusive', () => {
    expect(componentSource).toContain("view.mode === 'create'");
    expect(componentSource).toContain("view.mode === 'detail'");
    expect(componentSource).toContain("view.mode === 'reader'");
    expect(componentSource).not.toMatch(/view\.mode === 'list'[\s\S]*<KnowledgeEditor/);
    expect(componentSource).toContain('data-pt-knowledge-grid');
    expect(componentSource).toContain('data-pt-knowledge-reader');
  });

  it('states local hash retrieval honestly and without fabricated metrics', () => {
    expect(componentSource).toContain('settings.knowledge.retrievalNotice');
    expect(componentSource).toContain('settings.knowledge.retrievalLocal');
    expect(componentSource).not.toMatch(/vector\s*count|index\s*%/i);
  });
});
