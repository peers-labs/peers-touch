import { useState, useCallback, useRef, useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Markdown } from '@lobehub/ui';
import { Typography, Spin, Tag, message } from 'antd';
import { theme } from 'antd';
import {
  Globe,
  Search,
  ArrowLeft,
  Sparkles,
  ExternalLink,
  Pin,
} from 'lucide-react';
import { api } from '../../services/api';
import type { SearchResultItem } from '../../services/api';
import { MessageComposer } from '../../components/MessageComposer';

const { Title, Text } = Typography;

interface ResearchResult {
  query: string;
  answer?: SearchResultItem;
  sources: SearchResultItem[];
  loading: boolean;
  error?: string;
  timestamp: number;
}

export function WebSearchAppletPage({
  onBack,
  onPin,
  pinned,
}: {
  onBack: () => void;
  onPin?: () => void;
  pinned?: boolean;
}) {
  const [results, setResults] = useState<ResearchResult[]>([]);
  const [researching, setResearching] = useState(false);
  const { token } = theme.useToken();
  const resultsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    resultsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [results]);

  const handleResearch = useCallback(
    async (query: string) => {
      if (researching) return;
      setResearching(true);

      const newResult: ResearchResult = {
        query,
        sources: [],
        loading: true,
        timestamp: Date.now(),
      };
      setResults((prev) => [...prev, newResult]);

      try {
        const data = await api.search(query, 'web', 20);

        const items: SearchResultItem[] = data.results || [];
        if (data.groups) {
          for (const g of data.groups) {
            items.push(...g.items);
          }
        }

        const answer = items.find((item) => item.metadata?.type === 'ai_answer');
        const sources = items.filter((item) => item.metadata?.type !== 'ai_answer');

        setResults((prev) =>
          prev.map((r) =>
            r.timestamp === newResult.timestamp
              ? { ...r, answer, sources, loading: false }
              : r,
          ),
        );
      } catch (e: any) {
        setResults((prev) =>
          prev.map((r) =>
            r.timestamp === newResult.timestamp
              ? { ...r, loading: false, error: e.message || 'Research failed' }
              : r,
          ),
        );
        message.error('Research failed');
      } finally {
        setResearching(false);
      }
    },
    [researching],
  );

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <Flexbox
        horizontal
        align="center"
        gap={12}
        style={{
          padding: '12px 20px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          flexShrink: 0,
        }}
      >
        <div
          onClick={onBack}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: token.colorTextSecondary,
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = token.colorFillSecondary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <ArrowLeft size={18} />
        </div>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Globe size={18} color="#fff" />
        </div>
        <Flexbox flex={1}>
          <Text strong style={{ fontSize: 14 }}>
            Web Search Agent
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Portal-based AI research with RAG
          </Text>
        </Flexbox>
        {onPin && (
          <div
            onClick={onPin}
            title={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: pinned ? token.colorPrimary : token.colorTextQuaternary,
              background: pinned ? token.colorPrimaryBg : 'transparent',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!pinned) e.currentTarget.style.background = token.colorFillSecondary;
            }}
            onMouseLeave={(e) => {
              if (!pinned) e.currentTarget.style.background = 'transparent';
            }}
          >
            <Pin size={16} />
          </div>
        )}
      </Flexbox>

      {/* Results area */}
      <Flexbox
        flex={1}
        style={{ overflow: 'auto', padding: '20px 24px' }}
      >
        {results.length === 0 && (
          <Flexbox
            align="center"
            justify="center"
            gap={16}
            style={{ flex: 1, minHeight: 360 }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 18,
                background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 28px rgba(14, 165, 233, 0.2)',
              }}
            >
              <Globe size={32} color="#fff" />
            </div>
            <Flexbox align="center" gap={6}>
              <Title level={4} style={{ margin: 0 }}>
                Web Research Agent
              </Title>
              <Text
                type="secondary"
                style={{ fontSize: 13, textAlign: 'center', maxWidth: 440 }}
              >
                Ask any question. I'll analyze your curated portal sites,
                retrieve relevant articles, and synthesize insights with AI.
                Configure your sites in Settings → Web Search.
              </Text>
            </Flexbox>
            <Flexbox horizontal gap={8} wrap="wrap" justify="center" style={{ maxWidth: 520 }}>
              {[
                'Latest AI agent frameworks',
                'Tech industry trends this week',
                'Open source projects worth watching',
              ].map((s) => (
                <Tag
                  key={s}
                  onClick={() => handleResearch(s)}
                  style={{
                    cursor: 'pointer',
                    padding: '5px 12px',
                    borderRadius: 16,
                    fontSize: 12,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgContainer,
                  }}
                >
                  <Search size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                  {s}
                </Tag>
              ))}
            </Flexbox>
          </Flexbox>
        )}

        {results.map((result, idx) => (
          <ResearchResultCard key={idx} result={result} />
        ))}
        <div ref={resultsEndRef} />
      </Flexbox>

      {/* Composer */}
      <MessageComposer
        onSend={handleResearch}
        loading={researching}
        placeholder="Ask anything — I'll search your portal sites and synthesize insights..."
        autoFocus
        footer={
          <Text type="secondary" style={{ fontSize: 11 }}>
            Powered by Web Search Agent — analyzes curated portal sites with RAG + LLM
          </Text>
        }
      />
    </Flexbox>
  );
}

function ResearchResultCard({ result }: { result: ResearchResult }) {
  const { token } = theme.useToken();

  return (
    <Flexbox gap={14} style={{ marginBottom: 28 }}>
      {/* Query */}
      <Flexbox horizontal align="center" gap={10}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: token.colorFillSecondary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Search size={14} style={{ color: token.colorTextSecondary }} />
        </div>
        <Text strong style={{ fontSize: 14 }}>
          {result.query}
        </Text>
      </Flexbox>

      {/* Loading */}
      {result.loading && (
        <Flexbox
          horizontal
          align="center"
          gap={12}
          style={{
            padding: '16px 20px',
            borderRadius: 12,
            background: `linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorBgContainer})`,
            border: `1px solid ${token.colorPrimaryBorderHover}`,
          }}
        >
          <Spin size="small" />
          <Flexbox gap={2}>
            <Text strong style={{ fontSize: 13, color: token.colorPrimary }}>
              Researching...
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Retrieving from portal sites, analyzing content, synthesizing insights
            </Text>
          </Flexbox>
        </Flexbox>
      )}

      {/* Error */}
      {result.error && (
        <Flexbox
          style={{
            padding: '14px 18px',
            borderRadius: 12,
            background: token.colorErrorBg,
            border: `1px solid ${token.colorErrorBorder}`,
          }}
        >
          <Text type="danger" style={{ fontSize: 13 }}>{result.error}</Text>
        </Flexbox>
      )}

      {/* AI Answer */}
      {result.answer && (
        <Flexbox
          gap={10}
          style={{
            padding: '16px 20px',
            borderRadius: 12,
            background: `linear-gradient(135deg, ${token.colorPrimaryBg}80, ${token.colorBgContainer})`,
            border: `1px solid ${token.colorPrimaryBorderHover}`,
          }}
        >
          <Flexbox horizontal align="center" gap={6}>
            <Sparkles size={14} style={{ color: token.colorPrimary }} />
            <Text strong style={{ fontSize: 13, color: token.colorPrimary }}>
              AI Research Summary
            </Text>
            {result.answer.metadata?.model && (
              <Tag style={{ fontSize: 10, padding: '0 5px', borderRadius: 4, lineHeight: '16px' }}>
                {result.answer.metadata.model}
              </Tag>
            )}
          </Flexbox>
          <Markdown>{result.answer.snippet}</Markdown>
        </Flexbox>
      )}

      {/* Sources */}
      {result.sources.length > 0 && (
        <Flexbox gap={6}>
          <Flexbox horizontal align="center" gap={5}>
            <Globe size={12} style={{ color: token.colorTextSecondary }} />
            <Text
              type="secondary"
              style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              Sources ({result.sources.length})
            </Text>
          </Flexbox>
          <Flexbox gap={4}>
            {result.sources.map((source, i) => (
              <a
                key={i}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <Flexbox
                  horizontal
                  align="flex-start"
                  gap={10}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgContainer,
                    transition: 'all 0.15s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = token.colorPrimary;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = token.colorBorderSecondary;
                  }}
                >
                  <Text style={{ fontSize: 11, color: token.colorTextQuaternary, fontWeight: 600, width: 18, textAlign: 'center', flexShrink: 0 }}>
                    {i + 1}
                  </Text>
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Flexbox horizontal align="center" gap={4}>
                      <Text strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {source.title}
                      </Text>
                      <ExternalLink size={11} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
                    </Flexbox>
                    {source.snippet && (
                      <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {source.snippet}
                      </Text>
                    )}
                  </Flexbox>
                </Flexbox>
              </a>
            ))}
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
}
