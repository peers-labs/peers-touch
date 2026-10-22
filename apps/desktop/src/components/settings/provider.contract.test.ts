import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const menuSource = readFileSync(new URL('./ProviderMenu.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('./ProviderDetail.tsx', import.meta.url), 'utf8');
const cliDetailSource = readFileSync(new URL('./CliProviderDetail.tsx', import.meta.url), 'utf8');
const modelServiceSource = readFileSync(
  new URL('../ModelServiceTab.tsx', import.meta.url),
  'utf8',
);
const modelSelectSource = readFileSync(new URL('../ModelSelect.tsx', import.meta.url), 'utf8');

describe('Provider settings product contract', () => {
  it('uses one mixed list with a persisted usable-only preference', () => {
    expect(menuSource).toContain('showUsableProvidersOnly');
    expect(menuSource).toContain('setShowUsableProvidersOnly');
    expect(menuSource).toContain('isProviderUsable');
    expect(menuSource).toContain('ref={providerListRef}');
    expect(menuSource).toContain("selectedRow?.scrollIntoView({ block: 'nearest' })");
    expect(menuSource).not.toContain('<Tabs');
  });

  it('chooses Direct or CLI only inside Add Provider', () => {
    expect(menuSource).toContain("Form.useWatch<'direct' | 'cli'>");
    expect(menuSource).toContain('<Radio value="direct" className="pt-provider-kind-direct">');
    expect(menuSource).toContain('<Radio value="cli" className="pt-provider-kind-cli">');
    expect(menuSource).toContain('className="pt-provider-cli-adapter-select"');
    expect(menuSource).toContain("className: 'pt-provider-cli-adapter-option'");
    expect(menuSource).toContain('provider.runtime_kind === \'cli\'');
  });

  it('mounts a dedicated CLI schema with Station-owned execution metadata', () => {
    expect(detailSource).toContain("detail.runtime_kind === 'cli'");
    expect(detailSource).toContain('<CliProviderDetail key={`${detail.id}:${detail.version}`} detail={detail} />');
    expect(cliDetailSource).toContain('value={detail.cli_command}');
    expect(cliDetailSource).toContain('readOnly');
    expect(cliDetailSource).toContain('capabilities.model_discovery');
    expect(cliDetailSource).not.toContain('addModel');
    expect(cliDetailSource).not.toContain('toggleModel');
    expect(cliDetailSource).not.toContain('deleteModel');
    expect(cliDetailSource).not.toContain('toggleAllModels');
  });

  it('identifies Direct Provider availability controls by authority key', () => {
    expect(detailSource).toContain('data-pt-provider-enabled-toggle={detail.id}');
    expect(detailSource).toContain('data-pt-provider-model-toggle={m.id}');
    expect(detailSource).toContain('data-pt-provider-model-provider={detail.id}');
  });

  it('keeps Models focused on the global default only', () => {
    expect(modelServiceSource).toContain("const SLOT_KEYS: (keyof ModelServiceConfig)[] = [\n  'default',\n]");
    expect(modelServiceSource).toContain('className="pt-model-service-default-select"');
    expect(modelSelectSource).toContain("className: 'pt-model-select-option'");
    expect(modelSelectSource).toContain("'data-pt-model-provider': m.provider_id");
    expect(modelSelectSource).toContain("'data-pt-model-id': m.id");
    expect(modelServiceSource).not.toContain("'topicNaming'");
    expect(modelServiceSource).not.toContain("'translation'");
  });
});
