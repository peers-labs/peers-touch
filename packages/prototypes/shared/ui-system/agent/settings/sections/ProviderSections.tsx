/**
 * Providers + Models sections.
 *
 * Parity with the production provider store: direct vs CLI providers, a
 * reachability check, API key visibility toggle, base URL, per-model enable
 * switches, and a Models section whose default is chosen only from enabled
 * models of enabled providers. All state is local and deterministic.
 */
import { useState } from 'react';
import {
  Button, Flex, Icon, IconButton, ScrollArea, Select, Switch, Tag, Text, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../../prefs';
import { SEED_PROVIDERS } from '../ai-settings-data';
import { SettingsRow, SettingsSection } from '../SettingsPrimitives';
import type { ModelKind, ProviderRecord, Reachability } from '../types';

const MODEL_TONE: Record<ModelKind, 'info' | 'warning' | 'success'> = {
  chat: 'info',
  image: 'warning',
  embedding: 'success',
};

export function ProvidersSection() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [providers, setProviders] = useState<readonly ProviderRecord[]>(SEED_PROVIDERS);
  const [selId, setSelId] = useState(SEED_PROVIDERS[0].id);
  const [showKey, setShowKey] = useState(false);
  const [reach, setReach] = useState<Reachability>('idle');

  const selected = providers.find(p => p.id === selId) ?? providers[0];

  const patch = (id: string, patchValue: Partial<ProviderRecord>) => {
    setProviders(list => list.map(item => (item.id === id ? { ...item, ...patchValue } : item)));
  };

  const runReachability = () => {
    setReach('testing');
    window.setTimeout(() => {
      const ok = selected.kind === 'cli'
        ? selected.baseUrl.length > 0
        : selected.baseUrl.startsWith('http');
      setReach(ok ? 'ok' : 'fail');
    }, 650);
  };

  const addProvider = () => {
    const id = `direct-${Date.now()}`;
    setProviders(list => [...list, {
      id, name: 'New provider', kind: 'direct', enabled: true,
      apiKey: '', baseUrl: 'https://', models: [],
    }]);
    setSelId(id);
    setReach('idle');
  };

  const reachIcon = reach === 'testing' ? 'refresh-cw' : reach === 'ok' ? 'circle-check-big' : reach === 'fail' ? 'circle-slash' : 'activity';
  const reachLabel = reach === 'testing'
    ? t('agent.ai.providers.checking')
    : reach === 'ok'
      ? t('agent.ai.providers.ready')
      : reach === 'fail'
        ? t('agent.ai.providers.notReady')
        : t('agent.ai.providers.check');

  return (
    <Flex direction="row" gap={12} className="pa-providers" data-pt-ai-providers>
      <Flex direction="column" gap={4} className="pa-providers__list">
        <ScrollArea className="pa-providers__scroll">
          {providers.map(provider => (
            <Button
              key={provider.id}
              actionId={`ai.provider.select.${provider.id}`}
              emphasis="quiet"
              fullWidth
              className="pa-providers__item"
              aria-current={provider.id === selId ? 'page' : undefined}
              data-pt-provider={provider.id}
              onActivate={() => { setSelId(provider.id); setShowKey(false); setReach('idle'); }}
            >
              <Icon iconId={provider.kind === 'cli' ? 'terminal' : 'server'} size={15} />
              <span className="pa-providers__name">{provider.name}</span>
              <Tag tone={provider.kind === 'cli' ? 'warning' : 'info'}>
                {provider.kind === 'cli' ? t('agent.ai.providers.cli') : t('agent.ai.providers.direct')}
              </Tag>
            </Button>
          ))}
        </ScrollArea>
        <Button actionId="ai.provider.add" emphasis="quiet" density="compact"
          leading={<Icon iconId="plus" size={13} />}
          label={t('agent.ai.providers.add')} onActivate={addProvider} />
      </Flex>

      <SettingsSection
        iconId={selected.kind === 'cli' ? 'terminal' : 'server'}
        title={selected.name}
        testId="provider-detail"
        actions={(
          <Button actionId="ai.provider.check" emphasis="secondary" density="compact"
            leading={<Icon iconId={reachIcon} size={14} />}
            label={reachLabel} onActivate={runReachability} />
        )}
      >
        <SettingsRow label={t('agent.ai.providers.enabled')} description={t('agent.ai.providers.enabledDesc')}>
          <Switch checked={selected.enabled} label={t('agent.ai.providers.enabled')}
            onCheckedChange={checked => patch(selected.id, { enabled: checked })} />
        </SettingsRow>

        {selected.kind === 'direct' ? (
          <>
            <SettingsRow label={t('agent.ai.providers.apiKey')}>
              <Flex direction="row" gap={6} className="pa-providers__key">
                <TextField
                  aria-label={t('agent.ai.providers.apiKey')}
                  type={showKey ? 'text' : 'password'}
                  value={selected.apiKey}
                  placeholder="sk-..."
                  onValueChange={value => patch(selected.id, { apiKey: value })}
                />
                <IconButton actionId="ai.provider.toggle-key"
                  iconId={showKey ? 'eye-off' : 'eye'} iconSize={14}
                  label={showKey ? t('agent.ai.providers.hideKey') : t('agent.ai.providers.showKey')}
                  emphasis="quiet" onActivate={() => setShowKey(show => !show)} />
              </Flex>
            </SettingsRow>
            <SettingsRow label={t('agent.ai.providers.baseUrl')}>
              <TextField aria-label={t('agent.ai.providers.baseUrl')} value={selected.baseUrl}
                onValueChange={value => patch(selected.id, { baseUrl: value })} />
            </SettingsRow>
          </>
        ) : (
          <SettingsRow label={t('agent.ai.providers.baseUrl')}>
            <code className="pa-mono">{selected.baseUrl}</code>
          </SettingsRow>
        )}

        <Flex direction="column" gap={6} className="pa-providers__models">
          <Flex direction="row" align="center" justify="space-between">
            <Text strong>{t('agent.ai.providers.models')}</Text>
            <Button actionId={`ai.provider.${selected.id}.add-model`} emphasis="quiet" density="compact"
              leading={<Icon iconId="plus" size={13} />}
              label={t('agent.ai.providers.addModel')}
              onActivate={() => patch(selected.id, {
                models: [...selected.models, { id: `m-${Date.now()}`, name: 'new-model', kind: 'chat', enabled: true }],
              })} />
          </Flex>
          {selected.models.map(model => (
            <Flex key={model.id} direction="row" align="center" gap={8} className="pa-providers__model-row">
              <span className="pa-providers__model-name">{model.name}</span>
              <Tag tone={MODEL_TONE[model.kind]}>{model.kind}</Tag>
              <span className="pa-wb-spacer" />
              <Switch checked={model.enabled} label={`${model.name} enabled`}
                onCheckedChange={checked => patch(selected.id, {
                  models: selected.models.map(m =>
                    m.id === model.id ? { ...m, enabled: checked } : m),
                })} />
            </Flex>
          ))}
        </Flex>
      </SettingsSection>
    </Flex>
  );
}

export function ModelsSection() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const enabledProviders = SEED_PROVIDERS.filter(p => p.enabled);
  const options = enabledProviders.flatMap(p =>
    p.models.filter(m => m.enabled).map(m => ({
      value: m.id, label: `${p.name} · ${m.name}`,
    })));
  const [defaultModel, setDefaultModel] = useState(options[0]?.value ?? '');

  return (
    <SettingsSection iconId="brain" title={t('agent.ai.models.title')}
      subtitle={t('agent.ai.models.subtitle')} testId="models">
      <SettingsRow label={t('agent.ai.models.default')} description={t('agent.ai.models.defaultDesc')}>
        <Select
          aria-label={t('agent.ai.models.default')}
          value={defaultModel}
          options={options}
          onValueChange={value => setDefaultModel((Array.isArray(value) ? value[0] : value) ?? options[0]?.value ?? '')}
        />
      </SettingsRow>
      <Text tone="muted" className="pa-aisec__hint">{t('agent.ai.models.sourceHint')}</Text>
    </SettingsSection>
  );
}
