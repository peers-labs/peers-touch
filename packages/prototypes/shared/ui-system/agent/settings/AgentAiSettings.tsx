/**
 * AgentAiSettings — the Settings › AI surface rendered inside the Agent
 * module, composed entirely of peers-ui primitives.
 *
 * A fixed eight-section side nav (providers, models, discover, memory,
 * skills, mcp, voice, cron) mirrors the production Settings AI group order;
 * the right pane renders the active section. Keeping requirement #2 (the
 * Agent module contains the AI tab) inside the agent peer-only gate avoids
 * reaching into the lucide-based legacy settings prototype. Surface switching
 * (chat / profile / ai-settings) is owned by AgentFeature, not this pane.
 */
import { useState } from 'react';
import { Flex, Heading, Icon, ScrollArea, SideNav, Text } from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../prefs';
import { AI_SECTIONS } from './ai-settings-data';
import type { AiSectionId } from './types';
import { ModelsSection, ProvidersSection } from './sections/ProviderSections';
import { DiscoverSection, McpSection, SkillsSection } from './sections/CatalogSections';
import { MemorySection, VoiceSection } from './sections/MemoryVoiceSections';
import { CronSection } from './sections/CronSection';

export function AgentAiSettings() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [active, setActive] = useState<AiSectionId>('providers');

  const navItems = AI_SECTIONS.map(section => ({
    id: `ai.nav.${section.id}`,
    label: t(section.labelKey),
    icon: <Icon iconId={section.iconId} size={15} />,
    onActivate: () => setActive(section.id),
  }));

  const activeMeta = AI_SECTIONS.find(section => section.id === active);

  return (
    <Flex direction="row" className="pa-aisettings" data-pt-ai-settings={active}>
      <Flex direction="column" className="pa-aisettings__nav">
        <Flex direction="row" align="center" gap={8} className="pa-aisettings__nav-head">
          <Icon iconId="sparkles" size={16} />
          <Heading level={5}>{t('agent.ai.title')}</Heading>
        </Flex>
        <SideNav items={navItems} value={`ai.nav.${active}`} className="pa-aisettings__sidenav" />
      </Flex>

      <ScrollArea className="pa-aisettings__content">
        <Flex direction="column" gap={12} className="pa-aisettings__pane">
          <header className="pa-aisettings__pane-head">
            <Heading level={4}>{activeMeta ? t(activeMeta.labelKey) : ''}</Heading>
            {activeMeta && <Text tone="muted">{t(activeMeta.descKey)}</Text>}
          </header>
          {renderSection(active)}
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

function renderSection(active: AiSectionId) {
  switch (active) {
    case 'providers':
      return <ProvidersSection />;
    case 'models':
      return <ModelsSection />;
    case 'discover':
      return <DiscoverSection />;
    case 'memory':
      return <MemorySection />;
    case 'skills':
      return <SkillsSection />;
    case 'mcp':
      return <McpSection />;
    case 'voice':
      return <VoiceSection />;
    case 'cron':
      return <CronSection />;
    default:
      return null;
  }
}
