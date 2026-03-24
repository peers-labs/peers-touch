import { useEffect, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import {
  Input, Button, Typography, Tag, Switch, Spin, Popconfirm, theme, message,
} from 'antd';
import {
  Globe, Plus, Trash2, RefreshCw, ExternalLink, Check, X,
} from 'lucide-react';
import { api } from '../../services/desktop_api';

const { Text, Title } = Typography;

interface PortalSite {
  url: string;
  name: string;
  tags: string[];
  enabled: boolean;
  added_at: string;
  last_crawl?: string;
  articles: number;
}

export function WebSearchSettings() {
  const { token } = theme.useToken();
  const [sites, setSites] = useState<PortalSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingURL, setAddingURL] = useState('');
  const [adding, setAdding] = useState(false);
  const [crawling, setCrawling] = useState<string | null>(null);

  const loadSites = async () => {
    try {
      const resp = await api.appletAction<{ sites: PortalSite[] }>('web-search', 'list-sites');
      setSites(resp.sites || []);
    } catch {
      // Applet might not be active
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSites(); }, []);

  const handleAdd = async () => {
    if (!addingURL.trim()) return;
    setAdding(true);
    try {
      await api.appletAction('web-search', 'add-site', { url: addingURL.trim() });
      setAddingURL('');
      message.success('Site added successfully');
      await loadSites();
    } catch (err: any) {
      message.error(err.message || 'Failed to add site');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (url: string) => {
    try {
      await api.appletAction('web-search', 'remove-site', { url });
      message.success('Site removed');
      await loadSites();
    } catch (err: any) {
      message.error(err.message || 'Failed to remove site');
    }
  };

  const handleToggle = async (url: string, enabled: boolean) => {
    setSites((prev) => prev.map((s) => s.url === url ? { ...s, enabled } : s));
    try {
      await api.appletAction('web-search', 'toggle-site', { url, enabled });
    } catch (err: any) {
      setSites((prev) => prev.map((s) => s.url === url ? { ...s, enabled: !enabled } : s));
      message.error(err.message || 'Failed to toggle site');
    }
  };

  const handleCrawl = async (url: string) => {
    setCrawling(url);
    try {
      const resp = await api.appletAction<{ articles: number }>('web-search', 'crawl-site', { url });
      message.success(`Crawled ${resp.articles} articles`);
      await loadSites();
    } catch (err: any) {
      message.error(err.message || 'Crawl failed');
    } finally {
      setCrawling(null);
    }
  };

  const handleCrawlAll = async () => {
    setCrawling('all');
    try {
      await api.appletAction('web-search', 'crawl-all');
      message.success('Background crawl started');
    } catch (err: any) {
      message.error(err.message || 'Crawl failed');
    } finally {
      setTimeout(() => {
        setCrawling(null);
        loadSites();
      }, 3000);
    }
  };

  if (loading) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 40 }}>
        <Spin />
      </Flexbox>
    );
  }

  const enabledCount = sites.filter((s) => s.enabled).length;
  const totalArticles = sites.reduce((sum, s) => sum + s.articles, 0);

  return (
    <Flexbox gap={20} style={{ padding: 24, maxWidth: 700, overflow: 'auto', height: '100%' }}>
      {/* Header */}
      <Flexbox
        gap={12}
        style={{
          background: 'linear-gradient(135deg, #667eea15, #764ba215)',
          borderRadius: 12,
          padding: 20,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flexbox horizontal align="center" gap={8}>
          <Globe size={20} style={{ color: token.colorPrimary }} />
          <Title level={5} style={{ margin: 0 }}>Portal Sites</Title>
          <Tag>{enabledCount} active</Tag>
          <Tag color="blue">{totalArticles} articles</Tag>
        </Flexbox>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Configure the portal/news sites that the Web Search Agent will crawl and analyze.
          Add your preferred sites — the AI will auto-generate tags based on site content.
        </Text>
      </Flexbox>

      {/* Add site */}
      <Flexbox
        horizontal
        gap={8}
        align="center"
        style={{
          background: token.colorBgContainer,
          borderRadius: 10,
          padding: '12px 16px',
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Plus size={16} style={{ color: token.colorTextTertiary, flexShrink: 0 }} />
        <Input
          placeholder="Enter site URL (e.g. https://techcrunch.com)"
          value={addingURL}
          onChange={(e) => setAddingURL(e.target.value)}
          onPressEnter={handleAdd}
          variant="borderless"
          style={{ flex: 1 }}
        />
        <Button
          type="primary"
          size="small"
          loading={adding}
          onClick={handleAdd}
          disabled={!addingURL.trim()}
        >
          Add
        </Button>
      </Flexbox>

      {/* Crawl all button */}
      <Flexbox horizontal justify="flex-end">
        <Button
          size="small"
          icon={<RefreshCw size={12} className={crawling === 'all' ? 'spin' : ''} />}
          onClick={handleCrawlAll}
          loading={crawling === 'all'}
        >
          Crawl All Sites
        </Button>
      </Flexbox>

      {/* Site list */}
      <Flexbox gap={8}>
        {sites.map((site) => (
          <Flexbox
            key={site.url}
            gap={8}
            style={{
              background: token.colorBgContainer,
              borderRadius: 10,
              padding: '14px 16px',
              border: `1px solid ${site.enabled ? token.colorBorderSecondary : token.colorBorder}`,
              opacity: site.enabled ? 1 : 0.6,
              transition: 'opacity 0.2s',
            }}
          >
            <Flexbox horizontal justify="space-between" align="center">
              <Flexbox horizontal gap={10} align="center" style={{ flex: 1, minWidth: 0 }}>
                <Globe size={16} style={{ color: token.colorPrimary, flexShrink: 0 }} />
                <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Flexbox horizontal gap={6} align="center">
                    <Text strong style={{ fontSize: 14 }}>{site.name}</Text>
                    {site.articles > 0 && (
                      <Tag style={{ fontSize: 10 }}>{site.articles} articles</Tag>
                    )}
                  </Flexbox>
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {site.url}
                  </Text>
                </Flexbox>
              </Flexbox>

              <Flexbox horizontal gap={6} align="center" style={{ flexShrink: 0 }}>
                <Button
                  type="text"
                  size="small"
                  icon={<RefreshCw size={13} className={crawling === site.url ? 'spin' : ''} />}
                  onClick={() => handleCrawl(site.url)}
                  disabled={crawling === site.url}
                  title="Crawl now"
                />
                <Button
                  type="text"
                  size="small"
                  icon={<ExternalLink size={13} />}
                  onClick={() => window.open(site.url, '_blank')}
                  title="Open in browser"
                />
                <Switch
                  size="small"
                  checked={site.enabled}
                  onChange={(checked) => handleToggle(site.url, checked)}
                  checkedChildren={<Check size={10} />}
                  unCheckedChildren={<X size={10} />}
                />
                <Popconfirm
                  title="Remove this site?"
                  onConfirm={() => handleRemove(site.url)}
                  okText="Remove"
                  cancelText="Cancel"
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<Trash2 size={13} />}
                    title="Remove"
                  />
                </Popconfirm>
              </Flexbox>
            </Flexbox>

            {/* Tags */}
            {site.tags && site.tags.length > 0 && (
              <Flexbox horizontal gap={4} style={{ paddingLeft: 26 }}>
                {site.tags.map((tag) => (
                  <Tag key={tag} style={{ fontSize: 11, margin: 0 }}>{tag}</Tag>
                ))}
              </Flexbox>
            )}

            {/* Last crawl info */}
            {site.last_crawl && (
              <Text type="secondary" style={{ fontSize: 11, paddingLeft: 26 }}>
                Last crawled: {new Date(site.last_crawl).toLocaleString()}
              </Text>
            )}
          </Flexbox>
        ))}
      </Flexbox>

      {sites.length === 0 && (
        <Flexbox align="center" justify="center" gap={8} style={{ padding: 40 }}>
          <Globe size={32} style={{ color: token.colorTextQuaternary }} />
          <Text type="secondary">No portal sites configured</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Add sites above to start researching
          </Text>
        </Flexbox>
      )}
    </Flexbox>
  );
}
