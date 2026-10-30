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
  it('uses one scroll container with a persisted personal usable-only preference', () => {
    expect(menuSource).toContain('showUsableProvidersOnly');
    expect(menuSource).toContain('setShowUsableOnly');
    expect(menuSource).toContain('isProviderUsable');
    expect(menuSource).toContain('ref={providerListRef}');
    expect(menuSource).toContain("selectedRow?.scrollIntoView({ block: 'nearest' })");
    expect(menuSource).not.toContain('<Tabs');
  });

  it('exposes personal configuration only when the Station policy allows it', () => {
    expect(menuSource).toContain("managementMode === 'personal'");
    expect(menuSource).toContain('personalProvidersEnabled');
    expect(detailSource).toContain('AuthorizedProviderDetail');
    expect(menuSource).not.toContain('CliAdapterField');
  });

  it('renders CLI adapters with inline install, progress and manual fallback', () => {
    const installerSource = readFileSync(new URL(
      '../../../../station/app/subserver/dashboard/web/src/components/AIInstallers.tsx', import.meta.url,
    ), 'utf8');
    expect(installerSource).toContain("['trae-cli', 'TRAE CLI']");
    expect(installerSource).toContain("['codex-cli', 'Codex']");
    expect(installerSource).toContain("['cursor-cli', 'Cursor']");
    expect(installerSource).toContain("['claude-cli', 'Claude Code']");
    // The option background becomes the install progress bar.
    expect(installerSource).toContain('width: `${percent}%`');
    // Failure offers retry and vendor manual download, never a dead empty list.
    expect(installerSource).toContain("'retry'");
    expect(installerSource).toContain("t('ai.guide')");
    // Ready adapters are selectable; missing adapters never block listing.
    expect(installerSource).toContain("state === 'ready'");
    // Rows must render at natural width so four adapters are never clipped
    // by antd Form.Item's 32px control container.
    expect(installerSource).toContain('data-adapter={id}');
    expect(installerSource).toContain('aria-valuenow={percent}');
  });

  it('keeps shared installation and credential management outside Desktop', () => {
    const apiSource = readFileSync(new URL('../../services/desktop_api.ts', import.meta.url), 'utf8');
    expect(apiSource).not.toContain('installProvider:');
    const authorizedSource = readFileSync(new URL('./AuthorizedProviderDetail.tsx', import.meta.url), 'utf8');
    expect(authorizedSource).not.toContain('InputPassword');
    expect(authorizedSource).not.toContain('updateProvider');
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
