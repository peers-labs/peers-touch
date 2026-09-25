import { useMemo, useState } from 'react';
import { Avatar, Input, Typography } from 'antd';
import { ChevronRight, Search, UserPlus, Users } from 'lucide-react';
import type { Contact, GroupItem } from '../types';
import { demoContacts, demoGroups } from '../data';
import copy from '../../../../../locales/en/common.json';
import { demoRequestContact, type DemoFriendRequest } from '../socialDemo';
import { PrototypeListWindow } from '../components/PrototypeListWindow';
import type { PrototypeListMemory } from '../listPresentation';
import type { RequestRowSample } from '../longListDemo';

const { Text } = Typography;
const contactKey = (contact: Contact) => contact.key;
const requestKey = (request: RequestRowSample) => request.key;
const noRequestSamples: RequestRowSample[] = [];

export function ContactsPage({
  contacts = demoContacts, groups = demoGroups, requests = noRequestSamples,
  listMemory, request, onContactClick, onGroupClick, onAddContact,
}: {
  contacts?: Contact[];
  groups?: GroupItem[];
  requests?: RequestRowSample[];
  listMemory: PrototypeListMemory;
  request?: DemoFriendRequest | null;
  onContactClick: (c: Contact) => void;
  onGroupClick: (g: GroupItem) => void;
  onAddContact?: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState(() => listMemory.read('contacts-query')?.query ?? '');

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return [...contacts].sort((a, b) => a.name.localeCompare(b.name));
    const q = searchQuery.trim().toLowerCase();
    return contacts.filter((c) => c.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, searchQuery]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, searchQuery]);

  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return requests.filter((entry) => entry.contact.name.toLowerCase().includes(q));
  }, [requests, searchQuery]);

  return (
    <div className="mp-page" data-prototype-page="contacts">
      <header className="mp-header">
        <h1 className="mp-header-title">{copy['mobile.contacts.title']}</h1>
        <button type="button" className="mp-header-action" aria-label={copy['mobile.contacts.findPeople']} onClick={() => onAddContact?.()}>
          <UserPlus size={20} />
        </button>
      </header>

      <div className="mp-search-bar">
        <Input
          prefix={<Search size={16} color="#9ca0ab" />}
          placeholder={copy['mobile.contacts.searchPlaceholder']}
          allowClear
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            listMemory.save('contacts-query', { query: e.target.value });
          }}
        />
      </div>

      <div className="mp-contacts-body">
        {filteredGroups.length > 0 && (
          <section className="mp-contact-section">
            <div className="mp-section-header"><span>Groups</span></div>
            <div className="mp-group-list">
              {filteredGroups.map((group) => (
                <div key={group.key} className="mp-group-item" onClick={() => onGroupClick(group)}>
                  <Avatar size={44} style={{ background: group.avatarGradient, borderRadius: 14 }}>{group.avatar}</Avatar>
                  <div className="mp-group-info">
                    <Text strong>{group.name}</Text>
                    <Text type="secondary">{group.memberCount} members</Text>
                  </div>
                  <ChevronRight size={18} color="#9ca0ab" />
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mp-contact-section">
          <div className="mp-section-header"><span>Contacts</span></div>
          <div className="mp-contact-list">
            <PrototypeListWindow items={filteredContacts} itemKey={contactKey}
              surfaceKey={`contacts:${searchQuery.trim().toLowerCase()}`} memory={listMemory}>
              {(window) => window.map((contact, index) => (
                <div key={contact.key}>
                  {(index === 0 || window[index - 1].name[0].toUpperCase() !== contact.name[0].toUpperCase()) && (
                    <div className="mp-contact-letter">{contact.name[0].toUpperCase()}</div>
                  )}
                  <div key={contact.key} className="mp-contact-item" role="button" tabIndex={0}
                    data-scroll-anchor-id={contact.key}
                    onClick={() => onContactClick(contact)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onContactClick(contact);
                      }
                    }}>
                    <span className="mp-avatar-frame">
                      <Avatar size={44} style={{ background: contact.avatarGradient, borderRadius: 14 }}>{contact.avatar}</Avatar>
                      {contact.online && <span className="mp-online-dot" />}
                    </span>
                    <div className="mp-contact-info">
                      <Text strong>{contact.name}</Text>
                      <Text type="secondary">{contact.note}</Text>
                    </div>
                  </div>
                </div>
              ))}
            </PrototypeListWindow>
            {filteredContacts.length === 0 && (
              <div className="mp-request-item" role="status">
                <Text type="secondary">{copy['mobile.contacts.noSearchResults']}</Text>
              </div>
            )}
          </div>
        </section>
        {requests.length > 0 && (
          <section className="mp-contact-section">
            <div className="mp-section-header"><span>{copy['mobile.contacts.friendRequests']}</span></div>
            <div className="mp-request-list">
              <PrototypeListWindow items={filteredRequests} itemKey={requestKey}
                surfaceKey={`requests:${searchQuery.trim().toLowerCase()}`} memory={listMemory}>
                {(window) => window.map((entry) => (
                  <div key={entry.key} className="mp-request-item" data-scroll-anchor-id={entry.key}
                    data-demo-request-direction={entry.direction} data-demo-request-status={entry.status}>
                    <Avatar size={44} style={{ background: entry.contact.avatarGradient }}>
                      {entry.contact.avatar}
                    </Avatar>
                    <div className="mp-request-info">
                      <Text strong>{entry.contact.name}</Text>
                      <Text type="secondary">
                        {entry.direction === 'incoming' ? entry.contact.name : copy['mobile.contacts.self']}
                        {' \u2192 '}
                        {entry.direction === 'incoming' ? copy['mobile.contacts.self'] : entry.contact.name}
                      </Text>
                      <Text>{copy['mobile.contacts.requestPending']}</Text>
                    </div>
                  </div>
                ))}
              </PrototypeListWindow>
              {filteredRequests.length === 0 && (
                <div className="mp-request-item" role="status">
                  <Text type="secondary">{copy['mobile.contacts.noFriendRequests']}</Text>
                </div>
              )}
            </div>
          </section>
        )}
        {request?.status === 'sent' && (
          <section className="mp-contact-section">
            <div className="mp-section-header"><span>{copy['mobile.contacts.sentRequests']}</span></div>
            <div className="mp-request-list">
              <div className="mp-request-item">
                <Avatar size={44} style={{ background: demoRequestContact.avatarGradient }}>
                  {demoRequestContact.avatar}
                </Avatar>
                <div className="mp-request-info">
                  <Text strong>{demoRequestContact.name}</Text>
                  <Text type="secondary">{copy['mobile.contacts.waitingForAccept']}</Text>
                </div>
                <Text>{copy['mobile.contacts.requestPending']}</Text>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
