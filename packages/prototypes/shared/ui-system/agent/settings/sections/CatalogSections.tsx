/**
 * Discover, Skills and MCP sections — the capability catalog surfaces.
 *
 * Discover is the install/uninstall marketplace; Skills splits installed /
 * builtin / market with a scan state and an import entry; MCP manages bound
 * servers with reachability, tool expansion and add/remove. Every control is
 * a peers-ui primitive.
 */
import { useState } from 'react';
import type { IconId } from '@peers-touch/ui-assets';
import {
  Button, Empty, Flex, Icon, IconButton, ScrollArea, Switch, Tag, Text, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../../prefs';
import { SEED_CATALOG, SEED_MCP, SEED_SKILLS } from '../ai-settings-data';
import { SettingsSection } from '../SettingsPrimitives';
import type { McpServerRecord, Reachability, SkillRecord } from '../types';

export function DiscoverSection() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [query, setQuery] = useState('');
  const [installed, setInstalled] = useState<Set<string>>(
    () => new Set(SEED_CATALOG.filter(item => item.installed).map(item => item.id)));

  const packages = SEED_CATALOG.filter(item => {
    const q = query.trim().toLocaleLowerCase();
    return !q
      || item.name.toLocaleLowerCase().includes(q)
      || item.publisher.toLocaleLowerCase().includes(q)
      || item.type.toLocaleLowerCase().includes(q);
  });

  return (
    <SettingsSection iconId="search" title={t('agent.ai.discover.title')}
      subtitle={t('agent.ai.discover.subtitle')} testId="discover">
      <TextField
        aria-label={t('agent.ai.discover.search')}
        placeholder={t('agent.ai.discover.search')}
        value={query}
        onValueChange={setQuery}
      />
      <ScrollArea className="pa-catalog__scroll">
        {packages.length === 0 ? (
          <Empty description={t('agent.ai.discover.empty')} />
        ) : (
          <Flex direction="column" gap={6}>
            {packages.map(item => (
              <Flex key={item.id} direction="row" align="center" gap={10}
                className="pa-catalog__row" data-pt-package={item.id}>
                <span className="pa-catalog__text">
                  <Text strong>{item.name}</Text>
                  <Text tone="muted" className="pa-catalog__publisher">{item.publisher}</Text>
                </span>
                <Tag tone="neutral">{item.type}</Tag>
                <span className="pa-wb-spacer" />
                {installed.has(item.id) ? (
                  <Button actionId={`ai.discover.${item.id}.uninstall`} emphasis="quiet" density="compact"
                    label={t('agent.ai.discover.uninstall')}
                    onActivate={() => setInstalled(current => {
                      const next = new Set(current); next.delete(item.id); return next;
                    })} />
                ) : (
                  <Button actionId={`ai.discover.${item.id}.install`} emphasis="secondary" density="compact"
                    leading={<Icon iconId="plus" size={13} />}
                    label={t('agent.ai.discover.install')}
                    onActivate={() => setInstalled(current => new Set(current).add(item.id))} />
                )}
              </Flex>
            ))}
          </Flex>
        )}
      </ScrollArea>
    </SettingsSection>
  );
}

type SkillTab = 'installed' | 'builtin' | 'market';

export function SkillsSection() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [tab, setTab] = useState<SkillTab>('installed');
  const [skills, setSkills] = useState<SkillRecord[]>([...SEED_SKILLS]);
  const [importOpen, setImportOpen] = useState(false);
  const [addr, setAddr] = useState('');

  const visible = skills.filter(skill =>
    tab === 'installed' ? skill.installed && skill.source !== 'builtin'
      : tab === 'builtin' ? skill.source === 'builtin'
        : !skill.installed);

  const patch = (id: string, value: Partial<SkillRecord>) => {
    setSkills(previous => previous.map(skill =>
      skill.id === id ? { ...skill, ...value } : skill));
  };

  const doImport = () => {
    if (!addr.trim()) return;
    const name = addr.trim().split('/').pop()?.replace(/\.(zip|git)$/, '') || 'imported-skill';
    setSkills(previous => [{
      id: `sk-${Date.now()}`, name, desc: `Imported from ${addr}`,
      source: 'user', scan: 'warning', enabled: false, installed: true,
    }, ...previous]);
    setAddr('');
    setImportOpen(false);
    setTab('installed');
  };

  const tabOptions: { value: SkillTab; label: string }[] = [
    { value: 'installed', label: t('agent.ai.skills.installed') },
    { value: 'builtin', label: t('agent.ai.skills.builtin') },
    { value: 'market', label: t('agent.ai.skills.market') },
  ];

  return (
    <SettingsSection iconId="scroll-text" title={t('agent.ai.skills.title')}
      subtitle={t('agent.ai.skills.subtitle')} testId="skills"
      actions={(
        <Button actionId="ai.skill.import-open" emphasis="primary" density="compact"
          leading={<Icon iconId="plus" size={13} />}
          label={t('agent.ai.skills.import')} onActivate={() => setImportOpen(open => !open)} />
      )}>
      {importOpen && (
        <Flex direction="row" gap={6} className="pa-skills__import" data-pt-skill-import>
          <TextField aria-label="owner/repo" placeholder="owner/repo" value={addr}
            onValueChange={setAddr} onEnter={event => { event.preventDefault(); doImport(); }} />
          <Button actionId="ai.skill.import-confirm" emphasis="primary" density="compact"
            label={t('common.confirm')}
            availability={addr.trim() ? undefined : { kind: 'disabled', reason: t('agent.ai.skills.import') }}
            onActivate={doImport} />
        </Flex>
      )}
      {/* Library Tabs primitive owns the tablist role; no hand-rolled tab role. */}
      <div className="pa-skills__tabs" data-pt-skill-tabs>
        {tabOptions.map(option => (
          <Button
            key={option.value}
            actionId={`ai.skill.tab.${option.value}`}
            emphasis="quiet"
            density="compact"
            className="pa-skills__tab"
            aria-pressed={tab === option.value}
            label={option.label}
            onActivate={() => setTab(option.value)}
          />
        ))}
      </div>
      {visible.length === 0 ? (
        <Empty description={t('agent.ai.skills.empty')} />
      ) : (
        <Flex direction="column" gap={6}>
          {visible.map(skill => (
            <Flex key={skill.id} direction="row" align="center" gap={10}
              className="pa-skills__row" data-pt-skill={skill.id}>
              <Icon iconId="scroll-text" size={18} className="pa-skills__icon" />
              <span className="pa-skills__text">
                <Flex direction="row" align="center" gap={6}>
                  <Text strong>{skill.name}</Text>
                  <Tag tone="neutral">{skill.source}</Tag>
                  <Tag tone={skill.scan === 'passed' ? 'success' : 'warning'}>
                    {skill.scan === 'passed' ? t('agent.ai.skills.scanned') : t('agent.ai.skills.review')}
                  </Tag>
                </Flex>
                <Text tone="muted" className="pa-skills__desc">{skill.desc}</Text>
              </span>
              <span className="pa-wb-spacer" />
              {tab === 'market' ? (
                <Button actionId={`ai.skill.${skill.id}.install`} emphasis="primary" density="compact"
                  label={t('agent.ai.discover.install')}
                  onActivate={() => patch(skill.id, { installed: true, enabled: true })} />
              ) : (
                <Switch checked={skill.enabled} label={skill.name}
                  onCheckedChange={checked => patch(skill.id, { enabled: checked })} />
              )}
            </Flex>
          ))}
        </Flex>
      )}
    </SettingsSection>
  );
}

export function McpSection() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [servers, setServers] = useState<McpServerRecord[]>([...SEED_MCP]);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const patch = (id: string, value: Partial<McpServerRecord>) => {
    setServers(list => list.map(server =>
      server.id === id ? { ...server, ...value } : server));
  };

  const addServer = () => {
    if (!name.trim() || !endpoint.trim()) return;
    const slug = name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setServers(list => [...list, {
      id: list.some(s => s.id === `mcp-${slug}`) ? `mcp-${slug}-${Date.now()}` : `mcp-${slug}`,
      name: name.trim(), transport: 'stdio', endpoint: endpoint.trim(),
      enabled: true, toolCount: 0, tools: [], reachable: 'idle',
    }]);
    setName('');
    setEndpoint('');
    setAddOpen(false);
  };

  const reachIcon = (state: Reachability): IconId =>
    state === 'testing' ? 'refresh-cw' : state === 'ok' ? 'circle-check-big' : state === 'fail' ? 'circle-slash' : 'activity';

  return (
    <SettingsSection iconId="plug" title={t('agent.ai.mcp.title')}
      subtitle={t('agent.ai.mcp.subtitle')} testId="mcp"
      actions={(
        <Button actionId="ai.mcp.add-open" emphasis="primary" density="compact"
          leading={<Icon iconId="plus" size={13} />}
          label={t('agent.ai.mcp.add')} onActivate={() => setAddOpen(open => !open)} />
      )}>
      {addOpen && (
        <Flex direction="column" gap={6} className="pa-mcp__add" data-pt-mcp-add>
          <TextField aria-label={t('agent.ai.mcp.name')} placeholder={t('agent.ai.mcp.name')}
            value={name} onValueChange={setName} />
          <Flex direction="row" gap={6}>
            <TextField aria-label="endpoint" placeholder={t('agent.ai.mcp.endpointPlaceholder')}
              value={endpoint} onValueChange={setEndpoint}
              onEnter={event => { event.preventDefault(); addServer(); }} />
            <Button actionId="ai.mcp.add-confirm" emphasis="primary" density="compact"
              label={t('agent.ai.mcp.addBtn')}
              availability={name.trim() && endpoint.trim() ? undefined : { kind: 'disabled', reason: t('agent.ai.mcp.name') }}
              onActivate={addServer} />
          </Flex>
        </Flex>
      )}
      <Flex direction="column" gap={6}>
        {servers.map(server => (
          <Flex key={server.id} direction="column" gap={6}
            className="pa-mcp__row" data-pt-mcp={server.id}>
            <Flex direction="row" align="center" gap={10}>
              <Icon iconId="plug" size={18} className="pa-mcp__icon" />
              <span className="pa-mcp__text">
                <Flex direction="row" align="center" gap={6}>
                  <Text strong>{server.name}</Text>
                  <Tag tone={server.transport === 'stdio' ? 'neutral' : 'info'}>{server.transport}</Tag>
                  {server.toolCount > 0 && (
                    <Button actionId={`ai.mcp.${server.id}.expand`} emphasis="inline" density="compact"
                      label={`${server.toolCount} ${t('agent.ai.mcp.tools')}`}
                      onActivate={() => setExpanded(current => (current === server.id ? null : server.id))} />
                  )}
                </Flex>
                <code className="pa-mono">{server.endpoint}</code>
              </span>
              <Button actionId={`ai.mcp.${server.id}.test`} emphasis="quiet" density="compact"
                leading={<Icon iconId={reachIcon(server.reachable)} size={14} />}
                label={server.reachable === 'ok' ? t('agent.ai.mcp.ok') : t('agent.ai.mcp.test')}
                onActivate={() => {
                  patch(server.id, { reachable: 'testing' });
                  window.setTimeout(() => patch(server.id, { reachable: 'ok' }), 650);
                }} />
              <Switch checked={server.enabled} label={`${server.name} enabled`}
                onCheckedChange={checked => patch(server.id, { enabled: checked })} />
              <IconButton actionId={`ai.mcp.${server.id}.delete`} iconId="delete" iconSize={14}
                label={t('common.delete')} emphasis="quiet" tone="danger"
                data-pt-mcp-delete={server.id}
                onActivate={() => setServers(list => list.filter(item => item.id !== server.id))} />
            </Flex>
            {expanded === server.id && server.tools.length > 0 && (
              <Flex direction="row" gap={4} className="pa-mcp__tools">
                {server.tools.map(tool => <Tag key={tool} tone="neutral">{tool}</Tag>)}
              </Flex>
            )}
          </Flex>
        ))}
      </Flex>
    </SettingsSection>
  );
}
