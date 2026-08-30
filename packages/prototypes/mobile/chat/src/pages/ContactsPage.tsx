import { useMemo, useState } from 'react';
import { Avatar, Input, Typography } from 'antd';
import { ChevronRight, Search, UserPlus, Users } from 'lucide-react';
import type { Contact, GroupItem } from '../types';
import { demoContacts, demoGroups } from '../data';

const { Text } = Typography;

export function ContactsPage({ onContactClick, onGroupClick, onAddContact }: { onContactClick: (c: Contact) => void; onGroupClick: (g: GroupItem) => void; onAddContact?: () => void }) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return [...demoContacts].sort((a, b) => a.name.localeCompare(b.name));
    const q = searchQuery.toLowerCase();
    return [...demoContacts].filter((c) => c.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  }, [searchQuery]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return demoGroups;
    const q = searchQuery.toLowerCase();
    return demoGroups.filter((g) => g.name.toLowerCase().includes(q));
  }, [searchQuery]);

  const grouped = useMemo(() => {
    const map = new Map<string, Contact[]>();
    filteredContacts.forEach((c) => {
      const letter = c.name[0].toUpperCase();
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    });
    return Array.from(map.entries());
  }, [filteredContacts]);

  return (
    <div className="mp-page">
      <header className="mp-header">
        <h1 className="mp-header-title">Contacts</h1>
        <button type="button" className="mp-header-action" aria-label="Add contact" onClick={() => onAddContact?.()}>
          <UserPlus size={20} />
        </button>
      </header>

      <div className="mp-search-bar">
        <Input
          prefix={<Search size={16} color="#9ca0ab" />}
          placeholder="Search contacts or @user@host"
          allowClear
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
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
            {grouped.map(([letter, contacts]) => (
              <div key={letter}>
                <div className="mp-contact-letter">{letter}</div>
                {contacts.map((contact) => (
                  <div key={contact.key} className="mp-contact-item" onClick={() => onContactClick(contact)}>
                    <span className="mp-avatar-frame">
                      <Avatar size={44} style={{ background: contact.avatarGradient, borderRadius: 14 }}>{contact.avatar}</Avatar>
                      {contact.online && <span className="mp-online-dot" />}
                    </span>
                    <div className="mp-contact-info">
                      <Text strong>{contact.name}</Text>
                      <Text type="secondary">{contact.note}</Text>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
