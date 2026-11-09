import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settingsPageSource = readFileSync(
  new URL('./SettingsPage.tsx', import.meta.url),
  'utf8',
);
const languageSwitcherSource = readFileSync(
  new URL('../components/common/LanguageSwitcher.tsx', import.meta.url),
  'utf8',
);
const federationSource = readFileSync(
  new URL('../components/settings/FederationTab.tsx', import.meta.url),
  'utf8',
);
const cliProviderDetailSource = readFileSync(
  new URL('../components/settings/CliProviderDetail.tsx', import.meta.url),
  'utf8',
);
const larkChannelsSource = readFileSync(
  new URL('../components/settings/channels/LarkChannelsSettings.tsx', import.meta.url),
  'utf8',
);
const settingsPageFile = readFileSync(
  new URL('./SettingsPage.tsx', import.meta.url),
  'utf8',
);
const northstarCss = readFileSync(
  new URL('../ui/northstar.css', import.meta.url),
  'utf8',
);

function collectTsxSources(dirUrl: URL): string[] {
  return readdirSync(dirUrl, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dirUrl);
    if (entry.isDirectory()) return collectTsxSources(entryUrl);
    if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) return [];
    return [readFileSync(entryUrl, 'utf8')];
  });
}

const settingsComponentSources = collectTsxSources(
  new URL('../components/settings/', import.meta.url),
);

describe('general settings control alignment (north-star usage grammar)', () => {
  it('renders the agent visibility filter as a compact Segmented, not a dropdown', () => {
    // Prototype GeneralSections: extra={<Segmented density="compact" .../>}.
    const agentsExtra = settingsPageSource
      .slice(
        settingsPageSource.indexOf("title={t('settings.general.agentsTitle')}"),
        settingsPageSource.indexOf('settings.general.noAgents'),
      );
    expect(agentsExtra).toContain('<Segmented<string>');
    expect(agentsExtra).toContain('density="compact"');
    expect(agentsExtra).toContain('data-agent-visibility-filter');
    expect(agentsExtra).not.toContain('<Select');
  });

  it('places language in a settings row backed by the ghost Select, not a header popover', () => {
    const languageSection = settingsPageSource
      .slice(
        settingsPageSource.indexOf("title={t('settings.general.languageTitle')}"),
        settingsPageSource.indexOf('<SecuritySection />'),
      );
    expect(languageSection).toContain('<SettingsRow');
    expect(languageSection).toContain('variant="ghostSelect"');
    expect(languageSection).not.toContain('extra={<LanguageSwitcher />}');
  });

  it('keeps the shared LanguageSwitcher able to render the inline ghost Select', () => {
    expect(languageSwitcherSource).toMatch(/variant\?: 'menu' \| 'ghostSelect'/);
    expect(languageSwitcherSource).toContain("variant === 'ghostSelect'");
    expect(languageSwitcherSource).toContain('<Select<string>');
    expect(languageSwitcherSource).toContain('appearance="ghost"');
  });

  it('renders federation visibility as a normal-density Segmented, not a dropdown', () => {
    // Prototype NetworkSections models the reach/discovery policy as a
    // Segmented (anyone/federations/nobody) at the library default density;
    // compact is reserved for toolbar/extras (agents filter, files filter).
    const segmentedStart = federationSource.indexOf('<Segmented<FederationVisibilityLabel>');
    const segmentedEnd = federationSource.indexOf('/>', segmentedStart) + '/>'.length;
    const visibilityBlock = federationSource.slice(segmentedStart, segmentedEnd);
    expect(visibilityBlock).toContain('data-federation-visibility');
    expect(visibilityBlock).not.toContain('density=');
    expect(federationSource).not.toMatch(/<Select/);
  });

  it('keeps every settings multiline/choice/entry control on peers primitives, not native controls', () => {
    for (const source of settingsComponentSources) {
      expect(source).not.toMatch(/<textarea\b/);
      expect(source).not.toMatch(/<select\b/);
      expect(source).not.toMatch(/<input\b/);
    }
  });

  it('bans native buttons outside the two prototype-parallel channel cards', () => {
    for (const source of settingsComponentSources) {
      if (source === larkChannelsSource) continue;
      // KnowledgeSettings is agent-module content (capability_pb/agent store),
      // explicitly out of scope per the alignment objective.
      if (source.includes('domain/agent/') || source.includes('agentCapabilities')) continue;
      expect(source).not.toMatch(/<button\b/);
    }
    // The Lark surface keeps exactly its two documented bespoke cards.
    expect(larkChannelsSource.match(/<button\b/g)).toHaveLength(2);
  });

  it('renders the CLI advanced disclosure as a peers Button, not a native button', () => {
    expect(cliProviderDetailSource).not.toMatch(/<button\b/);
    expect(cliProviderDetailSource).toContain('sc-cli-detail__advanced');
    expect(cliProviderDetailSource).toMatch(/<Button[\s\S]*?actionId="cli-detail-advanced-toggle"/);
    expect(cliProviderDetailSource).toContain('aria-expanded={advancedOpen}');
  });

  it('opens applet settings from a peers quiet Button card, not a Flex onClick', () => {
    expect(settingsPageFile).toMatch(
      /<Button[\s\S]*?actionId=\{`applets-open-\$\{applet\.manifest\.id\}`\}[\s\S]*?className="sc-applet-card"/,
    );
    expect(settingsPageFile).not.toContain('sc-applet-card"\n              onClick');
    // Compound chrome must outrank .pt-button padding/border.
    const cardRule = northstarCss.match(/\.pt-button\.sc-applet-card\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(cardRule).toContain('padding: 16px 20px');
    expect(cardRule).toContain('border: 1px solid var(--pt-border)');
    expect(cardRule).toContain('background: var(--pt-surface)');
  });

  it('renders the settings shell without native buttons, using peers Button for the help accordion', () => {
    expect(settingsPageSource).not.toMatch(/<button\b/);
    expect(settingsPageSource).toContain('sc-help-accordion__header');
    expect(settingsPageSource).toMatch(/<Button[\s\S]*?actionId=\{`help-accordion-/);
    expect(settingsPageSource).toContain('aria-expanded={open}');
    // The accordion header carries the prototype disclosure chevron.
    expect(settingsPageSource).toContain('ChevronDown');
    expect(settingsPageSource).toContain('ChevronRight');
  });

  it('renders the About section as the plain prototype card without a gradient wash', () => {
    // The prototype AboutSection is a flat SettingsSection; the retired
    // desktop indigo/violet hero wash and its token-based replacement both
    // diverge from that grammar.
    expect(settingsPageSource).not.toContain('102, 126, 234');
    expect(settingsPageSource).not.toContain('118, 75, 162');
    const helpTabStart = settingsPageSource.indexOf('function HelpTab');
    const helpTabSlice = settingsPageSource.slice(helpTabStart);
    const aboutSection = helpTabSlice.slice(
      helpTabSlice.indexOf('<SettingsSection'),
      helpTabSlice.indexOf('</SettingsSection>'),
    );
    expect(aboutSection).toContain('icon={<Info size={18} />}');
    expect(aboutSection).not.toContain('linear-gradient');
    expect(aboutSection).not.toContain('style=');
  });
});
