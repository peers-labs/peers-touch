/**
 * IdentitySection — the SOUL.md / AGENTS.md instruction documents.
 *
 * Parity with production ProfileEditor › DocumentEditor: edits auto-save,
 * there is no manual Save button. Each editor debounces 600ms after the last
 * keystroke, commits immediately on blur, and flushes any pending draft on
 * unmount. A per-document saving/saved tag is the only status surface; the
 * prototype has no Station transport, so the "saving" window is the debounce
 * itself rather than a network round-trip.
 */
import { useEffect, useRef, useState } from 'react';
import { Card, Flex, Grid, Tag, TextArea } from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../prefs';
import type { ProfileDocuments } from './types';

interface IdentitySectionProps {
  documents: ProfileDocuments;
  onSave: (next: ProfileDocuments) => void;
}

type DocKey = keyof ProfileDocuments;
type SaveState = 'idle' | 'saving' | 'saved';

const AUTOSAVE_DELAY = 600;

export function IdentitySection({ documents, onSave }: IdentitySectionProps) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [drafts, setDrafts] = useState<ProfileDocuments>(documents);
  const [states, setStates] = useState<Record<DocKey, SaveState>>({ soulMd: 'idle', agentsMd: 'idle' });
  const timers = useRef<Partial<Record<DocKey, ReturnType<typeof setTimeout>>>>({});
  const latest = useRef(drafts);
  latest.current = drafts;

  // Re-sync when the persisted prop changes outside this section, but never
  // clobber a draft the user is actively typing.
  useEffect(() => {
    (Object.keys(documents) as DocKey[]).forEach((key) => {
      if (documents[key] !== latest.current[key] && !timers.current[key]) {
        setDrafts(previous => ({ ...previous, [key]: documents[key] }));
        setStates(previous => ({ ...previous, [key]: 'idle' }));
      }
    });
  }, [documents]);

  const flush = (key: DocKey) => {
    if (timers.current[key]) {
      clearTimeout(timers.current[key]);
      timers.current[key] = undefined;
    }
    if (latest.current[key] === documents[key]) {
      setStates(previous => ({ ...previous, [key]: 'idle' }));
      return;
    }
    setStates(previous => ({ ...previous, [key]: 'saving' }));
    onSave(latest.current);
    setStates(previous => ({ ...previous, [key]: 'saved' }));
  };

  const edit = (key: DocKey, value: string) => {
    setDrafts(previous => ({ ...previous, [key]: value }));
    setStates(previous => ({ ...previous, [key]: 'saving' }));
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => flush(key), AUTOSAVE_DELAY);
  };

  // Flush every pending debounce before leaving, mirroring the production
  // save-on-unmount guarantee so no typed edit is silently dropped.
  useEffect(() => () => {
    (Object.keys(timers.current) as DocKey[]).forEach((key) => {
      if (timers.current[key]) {
        clearTimeout(timers.current[key]);
        if (latest.current[key] !== documents[key]) onSave(latest.current);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderEditor = (key: DocKey, label: string) => {
    const state = states[key];
    const tagTone = state === 'saving' ? 'warning' : 'success';
    const tagLabel = state === 'saving' ? t('agent.profile.doc.saving') : t('agent.profile.doc.saved');
    return (
      <Card
        key={key}
        flat
        heading={label}
        actions={(
          <Tag tone={tagTone} data-pt-doc-state={key}>
            {tagLabel}
          </Tag>
        )}
        className="pa-doc-editor"
        data-pt-doc={key}
      >
        <TextArea
          value={drafts[key]}
          framing="embedded"
          minimumRows={14}
          maximumRows={22}
          aria-label={label}
          className="pa-doc-editor__textarea"
          data-pt-doc-input={key}
          onValueChange={value => edit(key, value)}
          onBlur={() => flush(key)}
        />
      </Card>
    );
  };

  return (
    <Flex direction="column" gap={10} className="pa-profile-identity">
      <Grid columns={2} gap={12} className="pa-profile-identity__grid">
        {renderEditor('soulMd', 'SOUL.md')}
        {renderEditor('agentsMd', 'AGENTS.md')}
      </Grid>
    </Flex>
  );
}
