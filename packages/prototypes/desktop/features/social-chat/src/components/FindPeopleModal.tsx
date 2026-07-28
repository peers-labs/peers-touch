import { useState } from 'react';
import { Search, Globe, ShieldCheck, UserPlus, X } from 'lucide-react';
import { T } from '../theme';

type SearchScope = 'all' | string;

interface MockFederation {
  id: string;
  name: string;
}

interface MockResult {
  id: string;
  displayName: string;
  handle: string;
  avatar: string;
  homeStation: string;
  verified: boolean;
}

const MOCK_FEDERATIONS: MockFederation[] = [
  { id: 'fed-1', name: 'aspen-network' },
  { id: 'fed-2', name: 'harbor-cluster' },
];

const MOCK_RESULTS: MockResult[] = [
  { id: '1', displayName: 'Mira Lin', handle: '@mira@aspen.social', avatar: '', homeStation: 'aspen', verified: true },
  { id: '2', displayName: 'Theo Park', handle: '@theo@harbor.io', avatar: '', homeStation: 'harbor', verified: true },
  { id: '3', displayName: 'Lena Chen', handle: '@lena@aspen.social', avatar: '', homeStation: 'aspen', verified: false },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function FindPeopleModal({ open, onClose }: Props) {
  const [searchText, setSearchText] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [results, setResults] = useState<MockResult[]>([]);
  const [sentIds, setSentIds] = useState<Set<string>>(() => new Set());

  if (!open) return null;

  const handleSearch = () => {
    if (!searchText.trim()) return;
    setResults(MOCK_RESULTS.filter((r) =>
      r.displayName.toLowerCase().includes(searchText.toLowerCase()) ||
      r.handle.toLowerCase().includes(searchText.toLowerCase()),
    ));
  };

  const handleScopeChange = (newScope: SearchScope) => {
    setScope(newScope);
    setResults([]);
  };

  const handleSend = (id: string) => {
    setSentIds((prev) => new Set(prev).add(id));
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.3)',
    }}>
      <div style={{
        width: 420, background: T.bg, borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px 12px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>Find People</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: 4, borderRadius: 6, color: T.textSecondary,
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Search input */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px',
          }}>
            <Search size={14} color={T.textSecondary} />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search @user or @user@host..."
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'none',
                fontSize: 13, color: T.text,
              }}
            />
            <button
              onClick={handleSearch}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, color: T.primary, fontWeight: 500,
              }}
            >
              Search
            </button>
          </div>

          {/* Scope tags */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <ScopeTag
              label="All"
              active={scope === 'all'}
              onClick={() => handleScopeChange('all')}
            />
            {MOCK_FEDERATIONS.map((fed) => (
              <ScopeTag
                key={fed.id}
                label={fed.name}
                icon={<Globe size={10} />}
                active={scope === fed.id}
                onClick={() => handleScopeChange(fed.id)}
              />
            ))}
          </div>

          {/* Results */}
          {results.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '32px 0',
              color: T.textSecondary, fontSize: 13,
            }}>
              Enter a username to search
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflow: 'auto' }}>
              {results.map((r) => (
                <ResultCard
                  key={r.id}
                  result={r}
                  sent={sentIds.has(r.id)}
                  onSend={() => handleSend(r.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScopeTag({ label, icon, active, onClick }: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500,
        cursor: 'pointer', transition: 'all 0.15s',
        border: `1px solid ${active ? T.primary : T.border}`,
        background: active ? `${T.primary}14` : 'transparent',
        color: active ? T.primary : T.textSecondary,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function ResultCard({ result, sent, onSend }: {
  result: MockResult;
  sent: boolean;
  onSend: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: 10,
      border: `1px solid ${T.border}`, background: T.bg,
    }}>
      {/* Avatar placeholder */}
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: `${T.primary}20`, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 600, color: T.primary,
      }}>
        {result.displayName.charAt(0)}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: T.text }}>
            {result.displayName}
          </span>
          {result.verified && (
            <ShieldCheck size={12} color={T.primary} />
          )}
        </div>
        <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 1 }}>
          {result.handle}
          {result.homeStation && (
            <span style={{ marginLeft: 6, opacity: 0.7 }}>
              · {result.homeStation}
            </span>
          )}
        </div>
      </div>

      {/* Action */}
      <button
        onClick={onSend}
        disabled={sent}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
          cursor: sent ? 'default' : 'pointer',
          border: 'none',
          background: sent ? `${T.primary}10` : T.primary,
          color: sent ? T.primary : '#fff',
        }}
      >
        <UserPlus size={12} />
        {sent ? 'Sent' : 'Add'}
      </button>
    </div>
  );
}
