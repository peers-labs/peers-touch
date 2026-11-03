import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { Icon, IconButton, Text, TextField } from '@peers-touch/ui';
import type { AvatarRenderState, Contact, GroupItem } from '../types';
import { demoContacts, demoGroups } from '../data';
import { demoRequestContact, type DemoFriendRequest } from '../socialDemo';
import { PrototypeListWindow } from '../components/PrototypeListWindow';
import type { PrototypeListMemory } from '../listPresentation';
import type { RequestRowSample } from '../longListDemo';
import { IdentityAvatar } from '../components/IdentityAvatar';

const contactKey = (contact: Contact) => contact.key;
const requestKey = (request: RequestRowSample) => request.key;
const noRequestSamples: RequestRowSample[] = [];

export function ContactsPage({
  contacts = demoContacts, groups = demoGroups, requests = noRequestSamples,
  listMemory, request, avatarState, onContactClick, onGroupClick, onAddContact, onCreateGroup,
}: {
  contacts?: Contact[];
  groups?: GroupItem[];
  requests?: RequestRowSample[];
  listMemory: PrototypeListMemory;
  request?: DemoFriendRequest | null;
  avatarState: AvatarRenderState;
  onContactClick: (c: Contact) => void;
  onGroupClick: (g: GroupItem) => void;
  onAddContact?: () => void;
  onCreateGroup?: () => void;
}) {
  const t = useT();
  // The page unmounts while a contact/group detail is open; the query survives
  // detail round-trips through the same shell-owned memory as window positions.
  const queryKey = 'contacts-query';
  const [searchQuery, setSearchQueryState] = useState(() => listMemory.read(queryKey)?.query ?? '');
  const setSearchQuery = (value: string) => {
    setSearchQueryState(value);
    listMemory.save(queryKey, { query: value });
  };

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return [...contacts].sort((a, b) => a.name.localeCompare(b.name));
    const q = searchQuery.trim().toLowerCase();
    return contacts.filter((c) => c.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, searchQuery]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return groups.filter((g) => !q || g.name.toLowerCase().includes(q));
  }, [groups, searchQuery]);

  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return requests.filter((entry) => entry.contact.name.toLowerCase().includes(q));
  }, [requests, searchQuery]);

  return (
    <div className="mp-page" data-prototype-page="contacts">
      <header className="mp-header">
        <h1 className="mp-header-title">{t('mobile.contacts.title')}</h1>
        <IconButton actionId="contacts.create-group" iconId="users" label={t('mobile.group.create')}
          emphasis="quiet" onActivate={() => onCreateGroup?.()} />
        <IconButton actionId="contacts.find-people" iconId="user-plus" label={t('mobile.contacts.findPeople')}
          emphasis="quiet" onActivate={() => onAddContact?.()} />
      </header>

      <div className="mp-search-well">
        <TextField
          aria-label={t('mobile.contacts.searchPlaceholder')}
          placeholder={t('mobile.contacts.searchPlaceholder')}
          value={searchQuery}
          clearable
          onClear={() => setSearchQuery('')}
          leading={<Icon iconId="search" size={16} />}
          onValueChange={setSearchQuery}
        />
      </div>

      <div className="mp-contacts-body">
        {filteredGroups.length > 0 && (
          <section className="mp-contact-section">
            <div className="mp-section-header"><span>{t('mobile.contacts.groupsTitle')}</span></div>
            <div className="mp-group-list">
              {filteredGroups.map((group) => (
                <button key={group.key} type="button" className="mp-group-item" onClick={() => onGroupClick(group)}>
                  <IdentityAvatar name={group.name} initials={group.avatar} kind="group"
                    size={40} renderState={avatarState} />
                  <div className="mp-group-info">
                    <Text strong>{group.name}</Text>
                    <Text tone="secondary">{group.memberCount} members</Text>
                  </div>
                  <span className="mp-row-chevron"><ChevronIcon /></span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mp-contact-section">
          <div className="mp-section-header"><span>{t('mobile.contacts.title')}</span></div>
          <div className="mp-contact-list">
            <PrototypeListWindow items={filteredContacts} itemKey={contactKey}
              surfaceKey={`contacts:${searchQuery.trim().toLowerCase()}`} memory={listMemory}>
              {(window) => window.map((contact, index) => (
                <div key={contact.key}>
                  {(index === 0 || window[index - 1].name[0].toUpperCase() !== contact.name[0].toUpperCase()) && (
                    <div className="mp-contact-letter">{contact.name[0].toUpperCase()}</div>
                  )}
                  <div className="mp-contact-item" role="button" tabIndex={0}
                    data-scroll-anchor-id={contact.key}
                    onClick={() => onContactClick(contact)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onContactClick(contact);
                      }
                    }}>
                    <IdentityAvatar name={contact.name} initials={contact.avatar}
                      src={contact.avatarUrl} size={40} online={contact.online}
                      showPresence renderState={avatarState} />
                    <div className="mp-contact-info">
                      <Text strong>{contact.name}</Text>
                      <Text tone="secondary">{contact.note}</Text>
                    </div>
                  </div>
                </div>
              ))}
            </PrototypeListWindow>
            {filteredContacts.length === 0 && (
              <div className="mp-request-item" role="status">
                <Text tone="secondary">{t('mobile.contacts.noSearchResults')}</Text>
              </div>
            )}
          </div>
        </section>
        {requests.length > 0 && (
          <section className="mp-contact-section">
            <div className="mp-section-header"><span>{t('mobile.contacts.friendRequests')}</span></div>
            <div className="mp-request-list">
              <PrototypeListWindow items={filteredRequests} itemKey={requestKey}
                surfaceKey={`requests:${searchQuery.trim().toLowerCase()}`} memory={listMemory}>
                {(window) => window.map((entry) => (
                  <div key={entry.key} className="mp-request-item" data-scroll-anchor-id={entry.key}
                    data-demo-request-direction={entry.direction} data-demo-request-status={entry.status}>
                    <IdentityAvatar name={entry.contact.name} initials={entry.contact.avatar}
                      src={entry.contact.avatarUrl} size={40} renderState={avatarState} />
                    <div className="mp-request-info">
                      <Text strong>{entry.contact.name}</Text>
                      <Text tone="secondary">
                        {entry.direction === 'incoming' ? entry.contact.name : t('mobile.contacts.self')}
                        {' → '}
                        {entry.direction === 'incoming' ? t('mobile.contacts.self') : entry.contact.name}
                      </Text>
                      <Text>{t('mobile.contacts.requestPending')}</Text>
                    </div>
                  </div>
                ))}
              </PrototypeListWindow>
              {filteredRequests.length === 0 && (
                <div className="mp-request-item" role="status">
                  <Text tone="secondary">{t('mobile.contacts.noFriendRequests')}</Text>
                </div>
              )}
            </div>
          </section>
        )}
        {request?.status === 'sent' && (
          <section className="mp-contact-section">
            <div className="mp-section-header"><span>{t('mobile.contacts.sentRequests')}</span></div>
            <div className="mp-request-list">
              <div className="mp-request-item">
                <IdentityAvatar name={demoRequestContact.name} initials={demoRequestContact.avatar}
                  src={demoRequestContact.avatarUrl} size={40} renderState={avatarState} />
                <div className="mp-request-info">
                  <Text strong>{demoRequestContact.name}</Text>
                  <Text tone="secondary">{t('mobile.contacts.waitingForAccept')}</Text>
                </div>
                <Text>{t('mobile.contacts.requestPending')}</Text>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ChevronIcon() {
  const t = useT();
  return <Icon iconId="chevron-right" size={18} />;
}
