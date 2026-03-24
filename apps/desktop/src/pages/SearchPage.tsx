import { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { SearchBar } from '@lobehub/ui';
import { Empty, Spin, Tag, Typography } from 'antd';
import { theme } from 'antd';
import {
  Search,
  MessageSquare,
  MessagesSquare,
  Wrench,
  HelpCircle,
  Server,
  Sparkles,
  Globe,
  Bot,
  ExternalLink,
  FileText,
  Loader2,
} from 'lucide-react';
import { useSearchStore } from '../store/search';
import type { SearchResultItem, SearchSourceGroup } from '../services/desktop_api';

function useDebounce(callback: (value: string) => void, delay: number) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  return useCallback(
    (value: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => callback(value), delay);
    },
    [callback, delay],
  );
}

const { Text, Paragraph, Title } = Typography;

const ICON_MAP: Record<string, React.ReactNode> = {
  MessageSquare: <MessageSquare size={16} />,
  MessagesSquare: <MessagesSquare size={16} />,
  Wrench: <Wrench size={16} />,
  HelpCircle: <HelpCircle size={16} />,
  Server: <Server size={16} />,
  Search: <Search size={16} />,
  Sparkles: <Sparkles size={16} />,
  Globe: <Globe size={16} />,
  FileText: <FileText size={16} />,
};

function getIcon(name?: string) {
  return ICON_MAP[name || ''] || <Search size={16} />;
}

function getSmallIcon(name?: string) {
  const map: Record<string, React.ReactNode> = {
    MessageSquare: <MessageSquare size={14} />,
    MessagesSquare: <MessagesSquare size={14} />,
    Wrench: <Wrench size={14} />,
    HelpCircle: <HelpCircle size={14} />,
    Server: <Server size={14} />,
    Search: <Search size={14} />,
    Sparkles: <Sparkles size={14} />,
    Globe: <Globe size={14} />,
    FileText: <FileText size={14} />,
  };
  return map[name || ''] || <Search size={14} />;
}

// ── Reusable Search Tab ──────────────────────────────────────────────

interface SearchTabLabelProps {
  icon: React.ReactNode;
  label: string;
  count?: number;
  loading?: boolean;
  active?: boolean;
}

function SearchTabLabel({ icon, label, count, loading, active }: SearchTabLabelProps) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      horizontal
      align="center"
      gap={6}
      style={{ whiteSpace: 'nowrap' }}
    >
      {icon}
      <span>{label}</span>
      {loading ? (
        <Loader2
          size={12}
          style={{
            color: active ? token.colorPrimary : token.colorTextSecondary,
            animation: 'search-tab-spin 1s linear infinite',
          }}
        />
      ) : count !== undefined && count > 0 ? (
        <span
          style={{
            fontSize: 11,
            lineHeight: '16px',
            padding: '0 5px',
            borderRadius: 8,
            background: active ? token.colorPrimaryBg : token.colorFillSecondary,
            color: active ? token.colorPrimary : token.colorTextSecondary,
            fontWeight: 500,
          }}
        >
          {count}
        </span>
      ) : null}
    </Flexbox>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function SearchPage({ onNavigate }: { onNavigate?: (url: string) => void }) {
  const {
    query, activeSource, sources, sourceResults, loadingPerSource,
    aiAnswer, aiSources, aiLoading,
    setActiveSource, loadSources, searchAll, search, aiSearch, reset,
  } = useSearchStore();

  const [inputValue, setInputValue] = useState(query);
  const SOURCE_TABS_ENABLED = true;

  const allGroups: SearchSourceGroup[] = useMemo(() => {
    return sources
      .filter(s => sourceResults[s.id] && sourceResults[s.id].length > 0)
      .map(s => ({
        source: s,
        items: sourceResults[s.id].slice(0, 5),
        total: sourceResults[s.id].length,
      }));
  }, [sources, sourceResults]);

  const currentSourceResults = activeSource !== 'all' && activeSource !== 'ai'
    ? sourceResults[activeSource] : undefined;

  const isAnySourceLoading = Object.values(loadingPerSource).some(Boolean);

  const totalAllCount = useMemo(() => {
    return Object.values(sourceResults).reduce((sum, r) => sum + (r?.length || 0), 0);
  }, [sourceResults]);

  const hasSearched = allGroups.length > 0
    || Object.values(sourceResults).some(r => r && r.length > 0)
    || !!aiAnswer;

  useEffect(() => {
    loadSources();
    return () => reset();
  }, [loadSources, reset]);

  useEffect(() => {
    if (!SOURCE_TABS_ENABLED && activeSource !== 'all' && activeSource !== 'ai') {
      setActiveSource('all');
    }
  }, [SOURCE_TABS_ENABLED, activeSource, setActiveSource]);

  const doSearch = useCallback((value: string) => {
    if (!value.trim()) {
      reset();
      return;
    }
    if (activeSource === 'ai') {
      aiSearch(value, false);
    } else if (activeSource === 'all') {
      searchAll(value);
    } else {
      search(value, activeSource);
    }
  }, [activeSource, searchAll, search, aiSearch, reset]);

  const debouncedSearch = useDebounce(doSearch, 250);

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value);
    if (activeSource === 'ai') {
      return;
    }
    debouncedSearch(value);
  }, [activeSource, debouncedSearch]);

  const handleEnterSearch = useCallback((value: string) => {
    if (!value.trim()) return;
    doSearch(value);
  }, [doSearch]);

  const handleTabChange = useCallback((key: string) => {
    setActiveSource(key);
  }, [setActiveSource]);

  const handleResultClick = useCallback((item: SearchResultItem) => {
    if (item.url && onNavigate) {
      onNavigate(item.url);
    }
  }, [onNavigate]);

  const { token } = theme.useToken();

  const tabItems = useMemo(() => {
    const items = [
      {
        key: 'all',
        label: (
          <SearchTabLabel
            icon={<Search size={14} />}
            label="All"
            count={query ? totalAllCount : undefined}
            loading={query ? isAnySourceLoading : false}
            active={activeSource === 'all'}
          />
        ),
      },
    ];

    if (SOURCE_TABS_ENABLED) {
      items.push(...sources.map((s) => ({
        key: s.id,
        label: (
          <SearchTabLabel
            icon={getSmallIcon(s.icon)}
            label={s.name}
            count={query && sourceResults[s.id] !== undefined ? sourceResults[s.id].length : undefined}
            loading={query ? loadingPerSource[s.id] || false : false}
            active={activeSource === s.id}
          />
        ),
      })));
    }

    items.push({
      key: 'ai',
      label: (
        <SearchTabLabel
          icon={<Sparkles size={14} />}
          label="AI Answer"
          loading={aiLoading}
          active={activeSource === 'ai'}
        />
      ),
    });

    return items;
  }, [SOURCE_TABS_ENABLED, sources, activeSource, sourceResults, loadingPerSource, query, totalAllCount, isAnySourceLoading, aiLoading]);

  return (
    <Flexbox flex={1} height="100%" style={{ overflow: 'auto' }}>
      {/* Inject keyframes for spinner animation */}
      <style>{`@keyframes search-tab-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Hero / Search Engine Header */}
      <Flexbox
        align="center"
        gap={hasSearched ? 16 : 32}
        style={{
          padding: hasSearched ? '32px 24px 0' : '15vh 24px 0',
          transition: 'padding 0.3s ease',
        }}
      >
        {!hasSearched && (
          <Flexbox align="center" gap={12}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 18,
                background: 'linear-gradient(135deg, #667eea, #764ba2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Bot size={32} color="#fff" />
            </div>
            <Title level={3} style={{ margin: 0 }}>
              Search Agent Box
            </Title>
            <Text type="secondary">
              Search conversations, tools, help, providers — or ask AI
            </Text>
          </Flexbox>
        )}

        <div style={{ width: '100%', maxWidth: 680 }}>
          <SearchBar
            placeholder="Search anything..."
            value={inputValue}
            enableShortKey
            shortKey="mod+k"
            onInputChange={handleInputChange}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onSearch={handleEnterSearch as any}
            allowClear
            size="large"
            style={{ width: '100%' }}
          />
        </div>

        {/* Custom tab bar */}
        <div style={{ width: '100%', maxWidth: 680, overflow: 'hidden' }}>
          <Flexbox
            horizontal
            gap={0}
            style={{
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              overflowX: 'auto',
              overflowY: 'hidden',
              scrollbarWidth: 'none',
            }}
          >
            {tabItems.map((t) => (
              <div
                key={t.key}
                onClick={() => handleTabChange(t.key)}
                style={{
                  padding: '8px 14px',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: activeSource === t.key ? token.colorPrimary : token.colorTextSecondary,
                  borderBottom: activeSource === t.key ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                  transition: 'all 0.15s',
                  flexShrink: 0,
                  userSelect: 'none',
                }}
              >
                {t.label}
              </div>
            ))}
          </Flexbox>
        </div>
      </Flexbox>

      {/* Results area */}
      <Flexbox
        style={{
          padding: '0 24px 48px',
          maxWidth: 728,
          width: '100%',
          margin: '0 auto',
        }}
      >
        {/* AI loading */}
        {activeSource === 'ai' && aiLoading && (
          <Flexbox align="center" style={{ padding: 48 }}>
            <Spin size="large" />
          </Flexbox>
        )}

        {/* AI Answer Tab */}
        {activeSource === 'ai' && !aiLoading && aiAnswer && (
          <AIAnswerPanel answer={aiAnswer} sources={aiSources} onNavigate={onNavigate} />
        )}

        {/* "All" tab: progressive grouped results */}
        {activeSource === 'all' && (
          <Flexbox gap={24}>
            {allGroups.map((group) => (
              <SourceGroupCard
                key={group.source.id}
                group={group}
                onItemClick={handleResultClick}
                onShowMore={() => handleTabChange(group.source.id)}
              />
            ))}
            {isAnySourceLoading && (
              <Flexbox align="center" style={{ padding: 24 }}>
                <Spin size="default" />
              </Flexbox>
            )}
          </Flexbox>
        )}

        {/* Single source tab */}
        {activeSource !== 'all' && activeSource !== 'ai' && (
          <>
            {loadingPerSource[activeSource] && (
              <Flexbox align="center" style={{ padding: 48 }}>
                <Spin size="large" />
              </Flexbox>
            )}
            {!loadingPerSource[activeSource] && currentSourceResults && currentSourceResults.length > 0 && (
              <Flexbox gap={8}>
                {currentSourceResults.map((item) => (
                  <ResultCard key={item.id} item={item} onClick={() => handleResultClick(item)} />
                ))}
              </Flexbox>
            )}
          </>
        )}

        {/* Empty state — per-source check */}
        {!aiLoading && query && (() => {
          if (activeSource === 'all') return !isAnySourceLoading && allGroups.length === 0;
          if (activeSource === 'ai') return !aiAnswer;
          return !loadingPerSource[activeSource]
            && sourceResults[activeSource] !== undefined
            && sourceResults[activeSource]!.length === 0;
        })() && (
          <Empty
            description="No results found"
            style={{ marginTop: 48 }}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function SourceGroupCard({
  group,
  onItemClick,
  onShowMore,
}: {
  group: SearchSourceGroup;
  onItemClick: (item: SearchResultItem) => void;
  onShowMore: () => void;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align="center" gap={8} style={{ padding: '4px 0' }}>
        {getIcon(group.source.icon)}
        <Text strong style={{ fontSize: 15 }}>{group.source.name}</Text>
        <Tag color="default" style={{ marginLeft: 4 }}>{group.total}</Tag>
      </Flexbox>
      {group.items.map((item) => (
        <ResultCard key={item.id} item={item} onClick={() => onItemClick(item)} />
      ))}
      {group.total > group.items.length && (
        <button
          onClick={onShowMore}
          style={{
            background: 'none',
            border: 'none',
            color: token.colorPrimary,
            cursor: 'pointer',
            padding: '4px 0',
            fontSize: 13,
            textAlign: 'left',
          }}
        >
          Show all {group.source.name} results...
        </button>
      )}
    </Flexbox>
  );
}

function ResultCard({
  item,
  onClick,
}: {
  item: SearchResultItem;
  onClick: () => void;
}) {
  const { token } = theme.useToken();
  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 16px',
        borderRadius: 10,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        cursor: 'pointer',
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = token.colorPrimary;
        e.currentTarget.style.boxShadow = `0 0 0 1px ${token.colorPrimaryBg}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = token.colorBorderSecondary;
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <Flexbox horizontal align="center" gap={8}>
        <span style={{ color: token.colorTextSecondary }}>
          {getIcon(item.icon)}
        </span>
        <Text strong style={{ fontSize: 14 }}>{item.title}</Text>
        {item.metadata?.category && (
          <Tag color="default" style={{ fontSize: 11 }}>{item.metadata.category}</Tag>
        )}
        {item.metadata?.status && (
          <Tag color={item.metadata.status === 'enabled' ? 'green' : 'default'} style={{ fontSize: 11 }}>
            {item.metadata.status}
          </Tag>
        )}
        {item.url && (
          <ExternalLink size={12} style={{ color: token.colorTextQuaternary, marginLeft: 'auto' }} />
        )}
      </Flexbox>
      {item.snippet && (
        <Paragraph
          type="secondary"
          style={{ margin: '4px 0 0 24px', fontSize: 13 }}
          ellipsis={{ rows: 2 }}
        >
          {item.snippet}
        </Paragraph>
      )}
    </div>
  );
}

function AIAnswerPanel({
  answer,
  sources,
  onNavigate,
}: {
  answer: string;
  sources: Array<{ title: string; source: string; url: string }>;
  onNavigate?: (url: string) => void;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox gap={16}>
      <div
        style={{
          padding: '20px 24px',
          borderRadius: 12,
          background: `linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorBgContainer})`,
          border: `1px solid ${token.colorPrimaryBorder}`,
        }}
      >
        <Flexbox horizontal align="center" gap={8} style={{ marginBottom: 12 }}>
          <Sparkles size={18} style={{ color: token.colorPrimary }} />
          <Text strong style={{ color: token.colorPrimary }}>AI Answer</Text>
        </Flexbox>
        <div
          style={{ fontSize: 14, lineHeight: 1.7, color: token.colorText }}
          dangerouslySetInnerHTML={{ __html: simpleMarkdown(answer) }}
        />
      </div>

      {sources.length > 0 && (
        <Flexbox gap={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>Sources</Text>
          {sources.map((s, i) => (
            <Flexbox
              key={i}
              horizontal
              align="center"
              gap={8}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
                cursor: s.url ? 'pointer' : 'default',
                fontSize: 13,
              }}
              onClick={() => s.url && onNavigate?.(s.url)}
            >
              <Tag color="blue" style={{ fontSize: 11 }}>{s.source}</Tag>
              <Text>{s.title}</Text>
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
}

function simpleMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}
