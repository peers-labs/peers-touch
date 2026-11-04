import { useEffect, useRef, useState, type Dispatch } from 'react';
import { useT } from '../i18n';
import { Button, Icon, RadioGroup, Text, TextField } from '@peers-touch/ui';
import { demoContacts } from '../data';
import { demoPeopleHandle, type SocialDemoAction, type SocialDemoState } from '../socialDemo';
import { RequestRecoveryNotice } from './ExperienceRecovery';
import { IdentityAvatar } from './IdentityAvatar';

export function FindPeopleSheet({
  state,
  dispatch,
  onClose,
}: {
  state: SocialDemoState;
  dispatch: Dispatch<SocialDemoAction>;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState(demoPeopleHandle);
  const [searchedQuery, setSearchedQuery] = useState(demoPeopleHandle);
  const [federationId, setFederationId] = useState(state.federations[0]?.id ?? '');
  const sheetRef = useRef<HTMLElement>(null);
  const results = demoContacts.filter((contact) => {
    const search = searchedQuery.trim().toLowerCase();
    return search && `${contact.name} ${contact.key} @${contact.key}@local.station`
      .toLowerCase().includes(search);
  });
  const validFederation = state.federations.some((entry) => entry.id === federationId);
  const queryChanged = query.trim() !== searchedQuery.trim();

  useEffect(() => {
    const previousFocus = document.activeElement;
    sheetRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
    if (event.key !== 'Tab') return;
    const controls = sheetRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
    );
    if (!controls?.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="mp-action-sheet-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={sheetRef}
        className="mp-action-sheet mp-find-people-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="find-people-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="mp-action-sheet-handle" />
        <header className="mp-social-sheet-header">
          <span className="mp-social-sheet-spacer" />
          <h2 id="find-people-title">{t('mobile.contacts.findPeople')}</h2>
          <Button actionId="find-people.close" emphasis="quiet" leading={<Icon iconId="close" size={18} />}
            aria-label={t('common.action.close')} onActivate={onClose} />
        </header>
        <div className="mp-people-content">
          <form onSubmit={(event) => { event.preventDefault(); setSearchedQuery(query); }}>
            <TextField
              aria-label={t('mobile.contacts.findPeoplePlaceholder')}
              placeholder={t('mobile.contacts.findPeoplePlaceholder')}
              value={query}
              clearable
              leading={<Icon iconId="user-round" size={16} />}
              trailing={<Button actionId="find-people.search" emphasis="primary" density="compact"
                behavior="submit">{t('mobile.contacts.search')}</Button>}
              onValueChange={(value) => {
                setQuery(value);
                if (!value.trim()) setSearchedQuery('');
              }}
            />
          </form>
          <fieldset className="mp-federation-field" disabled={state.request !== null}>
            <legend>{t('mobile.contacts.federation')}</legend>
            {state.federations.length > 0 ? (
              <RadioGroup value={federationId} disabled={state.request !== null}
                onValueChange={(value) => setFederationId(String(value))}
                options={state.federations.map((federation) => ({ value: federation.id, label: federation.name }))} />
            ) : (
              <Text id="people-membership-state" role="status" tone="secondary">
                {t('mobile.contacts.noFederation')}
              </Text>
            )}
          </fieldset>
          <RequestRecoveryNotice request={state.request}
            onCheck={() => dispatch({ type: 'check-request' })} />
          <div className="mp-people-results">
            {results.length ? results.map((contact) => {
              const friend = state.contacts.some((entry) => entry.key === contact.key);
              const request = state.request?.contactKey === contact.key ? state.request : null;
              const pending = request?.status === 'pending';
              return (
                <div className="mp-people-result" key={contact.key}>
                  <div className="mp-request-item">
                    <IdentityAvatar name={contact.name} initials={contact.avatar}
                      src={contact.avatarUrl} size={40} />
                    <div className="mp-request-info">
                      <Text strong>{contact.name}</Text>
                      <Text tone="secondary" className="mp-people-handle">
                        {`@${contact.key}@local.station`}
                      </Text>
                    </div>
                  </div>
                  <Button actionId={`find-people.request.${contact.key}`} emphasis="primary" fullWidth
                    execution={pending ? 'pending' : 'idle'}
                    availability={(friend || state.request !== null || !validFederation || queryChanged)
                      ? { kind: 'disabled', reason: friend
                        ? t('mobile.contacts.alreadyFriend')
                        : !validFederation ? t('mobile.contacts.noFederation') : 'Outcome pending' }
                      : undefined}
                    aria-describedby={!validFederation ? 'people-membership-state' : undefined}
                    onActivate={() => dispatch({ type: 'send-request', contactKey: contact.key, federationId })}
                  >
                    {friend ? t('mobile.contacts.alreadyFriend')
                      : request?.status === 'sent' ? t('mobile.contacts.requestSent')
                      : pending ? t('mobile.contacts.requestPending')
                      : t('mobile.contacts.sendRequest')}
                  </Button>
                </div>
              );
            }) : (
              <Text tone="secondary" role="status">
                {t(searchedQuery ? 'mobile.contacts.noPeopleResults' : 'mobile.contacts.findPeopleHint')}
              </Text>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
