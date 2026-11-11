/**
 * ExtensionPickerDialog — the lazy capability catalog, never Profile content.
 *
 * Parity with production ExtensionPicker: a search box plus bounded,
 * incrementally revealed results. The whole catalog never mounts as Profile
 * rows; binding one entry adds exactly one bound row and closes the picker.
 */
import { useMemo, useState } from 'react';
import {
  Button, Dialog, Empty, Flex, Icon, ScrollArea, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../prefs';
import type { CatalogEntry, ExtensionKind } from './types';

interface ExtensionPickerDialogProps {
  kind: ExtensionKind;
  catalog: readonly CatalogEntry[];
  onBind: (entry: CatalogEntry) => void;
  onClose: () => void;
}

const PAGE = 6;

export function ExtensionPickerDialog({ kind, catalog, onBind, onClose }: ExtensionPickerDialogProps) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return catalog;
    return catalog.filter(entry =>
      entry.name.toLocaleLowerCase().includes(needle)
      || entry.description.toLocaleLowerCase().includes(needle));
  }, [catalog, query]);

  const visible = filtered.slice(0, limit);

  return (
    <Dialog
      open
      width={520}
      title={kind === 'skill' ? t('agent.profile.extensions.addSkill') : t('agent.profile.extensions.addMcp')}
      closeLabel={t('agent.common.cancel')}
      onDismiss={onClose}
    >
      <Flex direction="column" gap={10}>
        <TextField
          autoFocus
          clearable
          value={query}
          aria-label={t('agent.profile.extensions.search')}
          placeholder={t('agent.profile.extensions.search')}
          onClear={() => { setQuery(''); setLimit(PAGE); }}
          onValueChange={(value) => { setQuery(value); setLimit(PAGE); }}
        />
        <ScrollArea className="pa-extension-picker__list" maxHeight={360}>
          {visible.length === 0 ? (
            <Empty description={t('agent.profile.extensions.noMatches')} />
          ) : (
            <Flex direction="column" gap={4}>
              {visible.map(entry => (
                <Button
                  key={entry.capabilityId}
                  actionId={`extension.bind.${entry.capabilityId}`}
                  emphasis="quiet"
                  fullWidth
                  className="pa-extension-picker__row"
                  data-pt-extension-catalog={entry.capabilityId}
                  onActivate={() => { onBind(entry); onClose(); }}
                >
                  <Icon iconId={entry.kind === 'skill' ? 'book-open' : 'plug'} size={15}
                    className="pa-extension-picker__icon" />
                  <span className="pa-extension-picker__text">
                    <span className="pa-extension-picker__name">{entry.name}</span>
                    <span className="pa-extension-picker__desc">{entry.description}</span>
                  </span>
                  <Icon iconId="plus" size={14} className="pa-extension-picker__add" />
                </Button>
              ))}
            </Flex>
          )}
        </ScrollArea>
        {limit < filtered.length && (
          <Button actionId="extension.show-more" emphasis="quiet"
            label={t('agent.profile.extensions.showMore')}
            onActivate={() => setLimit(value => value + PAGE)} />
        )}
      </Flex>
    </Dialog>
  );
}
