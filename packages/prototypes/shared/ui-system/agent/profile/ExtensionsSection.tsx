/**
 * ExtensionsSection — capabilities already bound to this Agent.
 *
 * Parity with production ExtensionsPanel: Skills and MCP groups, each showing
 * only bound rows with an enable Switch and a remove action; the icon-only `+`
 * opens the lazy catalog picker (search + bounded results), never an inline
 * catalog. Task orchestration is a module-level surface, not a Profile entry.
 */
import { useState } from 'react';
import type { IconId } from '@peers-touch/ui-assets';
import {
  Empty, Flex, Icon, IconButton, Switch, Tag, Text,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../prefs';
import { EXTENSION_CATALOG } from './profile-data';
import { ExtensionPickerDialog } from './ExtensionPickerDialog';
import type { CatalogEntry, ExtensionKind, ExtensionRecord } from './types';

interface ExtensionsSectionProps {
  extensions: ExtensionRecord[];
  onChanges: (next: ExtensionRecord[]) => void;
}

export function ExtensionsSection({ extensions, onChanges }: ExtensionsSectionProps) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [pickerKind, setPickerKind] = useState<ExtensionKind | null>(null);

  const groups: Array<{ kind: ExtensionKind; iconId: IconId; label: string; addLabel: string; emptyLabel: string }> = [
    { kind: 'skill', iconId: 'book-open', label: t('agent.profile.extensions.skills'), addLabel: t('agent.profile.extensions.addSkill'), emptyLabel: t('agent.profile.extensions.noSkills') },
    { kind: 'mcp', iconId: 'plug', label: t('agent.profile.extensions.mcp'), addLabel: t('agent.profile.extensions.addMcp'), emptyLabel: t('agent.profile.extensions.noMcp') },
  ];

  const catalogFor = (kind: ExtensionKind): CatalogEntry[] => {
    const boundIds = new Set(extensions.map(item => item.capabilityId));
    return EXTENSION_CATALOG.filter(entry => entry.kind === kind && !boundIds.has(entry.capabilityId));
  };

  const toggle = (capabilityId: string, enabled: boolean) => {
    onChanges(extensions.map(item =>
      item.capabilityId === capabilityId ? { ...item, enabled } : item));
  };

  const remove = (capabilityId: string) => {
    onChanges(extensions.filter(item => item.capabilityId !== capabilityId));
  };

  const bind = (entry: CatalogEntry) => {
    onChanges([
      ...extensions,
      {
        capabilityId: entry.capabilityId,
        kind: entry.kind,
        name: entry.name,
        description: entry.description,
        enabled: true,
      },
    ]);
  };

  return (
    <Flex direction="column" gap={12} className="pa-profile-extensions">
      {groups.map(group => {
        const rows = extensions.filter(item => item.kind === group.kind);
        return (
          <Flex key={group.kind} direction="column" gap={6}
            className="pa-extension-group" aria-label={group.label}
            data-pt-extension-group={group.kind}>
            <Flex direction="row" align="center" gap={8} className="pa-extension-group__head">
              <Icon iconId={group.iconId} size={15} className="pa-extension-group__icon" />
              <Text strong>{group.label}</Text>
              <Tag tone="neutral">{rows.length}</Tag>
              <span className="pa-wb-spacer" />
              <IconButton
                actionId={`profile.extension-add.${group.kind}`}
                iconId="plus"
                iconSize={15}
                label={group.addLabel}
                emphasis="quiet"
                density="compact"
                data-pt-extension-add={group.kind}
                onActivate={() => setPickerKind(group.kind)}
              />
            </Flex>
            {rows.length === 0 ? (
              <Text tone="muted" className="pa-extension-group__empty">{group.emptyLabel}</Text>
            ) : (
              <Flex direction="column" gap={4}>
                {rows.map(extension => (
                  <Flex key={extension.capabilityId} direction="row" align="center" gap={10}
                    className="pa-extension-row" data-pt-extension={extension.capabilityId}>
                    <span className="pa-extension-row__text">
                      <Text strong className="pa-extension-row__name">{extension.name}</Text>
                      <Text tone="muted" className="pa-extension-row__desc">{extension.description}</Text>
                    </span>
                    <Switch
                      checked={extension.enabled}
                      label={t('agent.profile.extensions.toggle', { name: extension.name })}
                      data-pt-extension-switch={extension.capabilityId}
                      onCheckedChange={checked => toggle(extension.capabilityId, checked)}
                    />
                    <IconButton
                      actionId={`profile.extension-remove.${extension.capabilityId}`}
                      iconId="delete"
                      iconSize={14}
                      label={t('agent.profile.extensions.remove', { name: extension.name })}
                      emphasis="quiet"
                      density="compact"
                      tone="danger"
                      data-pt-extension-remove={extension.capabilityId}
                      onActivate={() => remove(extension.capabilityId)}
                    />
                  </Flex>
                ))}
              </Flex>
            )}
          </Flex>
        );
      })}

      {pickerKind && (
        <ExtensionPickerDialog
          kind={pickerKind}
          catalog={catalogFor(pickerKind)}
          onBind={bind}
          onClose={() => setPickerKind(null)}
        />
      )}
    </Flex>
  );
}
