import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent } from 'react';
import { Avatar, Button, Input, Radio, Typography } from 'antd';
import { X } from 'lucide-react';
import copy from '../../../../../locales/en/common.json';
import { demoContacts } from '../data';
import { demoPeopleHandle, type SocialDemoAction, type SocialDemoState } from '../socialDemo';
import { RequestRecoveryNotice } from './ExperienceRecovery';

export function FindPeopleSheet({
  state,
  dispatch,
  onClose,
}: {
  state: SocialDemoState;
  dispatch: Dispatch<SocialDemoAction>;
  onClose: () => void;
}) {
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

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
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
    <div className="mp-action-sheet-backdrop" onClick={onClose}>
      <section
        ref={sheetRef}
        className="mp-action-sheet mp-find-people-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="find-people-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mp-action-sheet-handle" />
        <header className="mp-detail-header">
          <h2 className="mp-detail-header-title" id="find-people-title">
            {copy['mobile.contacts.findPeople']}
          </h2>
          <Button type="text" icon={<X size={20} />} onClick={onClose}
            aria-label={copy['common.action.close']} />
        </header>
        <div className="mp-people-content">
          <Input.Search
            aria-label={copy['mobile.contacts.findPeoplePlaceholder']}
            placeholder={copy['mobile.contacts.findPeoplePlaceholder']}
            enterButton={copy['mobile.contacts.search']}
            value={query}
            allowClear
            onChange={(event) => {
              setQuery(event.target.value);
              if (!event.target.value.trim()) setSearchedQuery('');
            }}
            onSearch={(value) => setSearchedQuery(value)}
          />
          <fieldset className="mp-federation-field" disabled={state.request !== null}>
            <legend>{copy['mobile.contacts.federation']}</legend>
            {state.federations.length > 0 ? (
              <Radio.Group value={federationId} disabled={state.request !== null}
                onChange={(event) => setFederationId(String(event.target.value))}>
                {state.federations.map((federation) => (
                  <Radio key={federation.id} value={federation.id}>{federation.name}</Radio>
                ))}
              </Radio.Group>
            ) : (
              <Typography.Text id="people-membership-state" role="status">
                {copy['mobile.contacts.noFederation']}
              </Typography.Text>
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
                    <Avatar size={44} style={{ background: contact.avatarGradient }}>
                      {contact.avatar}
                    </Avatar>
                    <div className="mp-request-info">
                      <Typography.Text strong>{contact.name}</Typography.Text>
                      <Typography.Text type="secondary" className="mp-people-handle">
                        {`@${contact.key}@local.station`}
                      </Typography.Text>
                    </div>
                  </div>
                  <Button
                    type="primary"
                    block
                    loading={pending}
                    disabled={friend || state.request !== null || !validFederation || queryChanged}
                    aria-describedby={!validFederation ? 'people-membership-state' : undefined}
                    onClick={() => dispatch({ type: 'send-request', contactKey: contact.key, federationId })}
                  >
                    {friend ? copy['mobile.contacts.alreadyFriend']
                      : request?.status === 'sent' ? copy['mobile.contacts.requestSent']
                      : pending ? copy['mobile.contacts.requestPending']
                      : copy['mobile.contacts.sendRequest']}
                  </Button>
                </div>
              );
            }) : (
              <Typography.Text type="secondary" role="status">
                {copy[searchedQuery ? 'mobile.contacts.noPeopleResults' : 'mobile.contacts.findPeopleHint']}
              </Typography.Text>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
