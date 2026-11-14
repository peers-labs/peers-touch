import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const modelServiceSource = readFileSync(
  new URL('../ModelServiceTab.tsx', import.meta.url),
  'utf8',
);
const modelSelectSource = readFileSync(new URL('../ModelSelect.tsx', import.meta.url), 'utf8');

describe('Provider settings product contract', () => {
  it('keeps Models focused on the global default only', () => {
    expect(modelServiceSource).toContain("const SLOT_KEYS = ['default'] as const");
    expect(modelServiceSource).toContain('runtimeDefault');
    expect(modelServiceSource).not.toContain('api.getModelConfig');
    expect(modelServiceSource).toContain('className="pt-model-service-default-select"');
    expect(modelSelectSource).toContain("className: 'pt-model-select-option'");
    expect(modelSelectSource).toContain("'data-pt-model-provider': m.provider_id");
    expect(modelSelectSource).toContain("'data-pt-model-id': m.id");
    expect(modelServiceSource).not.toContain("'topicNaming'");
    expect(modelServiceSource).not.toContain("'translation'");
  });
});