import { useEffect, useState, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Check, ChevronRight, Settings, Search, X, Eye, Wrench, Sparkles, Globe, Image } from 'lucide-react';
import { ProviderIcon } from './settings/ProviderIcon';
import { Tooltip } from '@lobehub/ui';
import { Divider, Skeleton, theme } from 'antd';
import { useAgentStore } from '../store/agent';
import type { AvailableModel } from '../services/desktop_api';
import { useTranslation } from 'react-i18next';

interface ModelProviderSelectProps {
  models?: AvailableModel[];
  selectedModelId?: string;
  onSelect: (modelId: string, providerId: string) => void;
  onClose: () => void;
  onNavigateSettings?: () => void;
}

function formatContextWindow(v: number): string {
  if (v >= 1000000) return `${(v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}K`;
  return String(v);
}

export function ModelProviderSelect({
  models,
  selectedModelId,
  onSelect,
  onClose,
  onNavigateSettings,
}: ModelProviderSelectProps) {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const availableModels = useAgentStore(s => s.availableModels);
  const defaultModel = useAgentStore(s => s.defaultModel);
  const modelsLoading = useAgentStore(s => s.loading);
  const loadModels = useAgentStore(s => s.loadModels);
  const [searchQuery, setSearchQuery] = useState('');

  const effectiveModels = models ?? availableModels;
  const currentId = selectedModelId ?? defaultModel;
  // Show loading skeleton only when using store models (not prop-injected) and loading for the first time
  const showSkeleton = !models && modelsLoading && effectiveModels.length === 0;

  useEffect(() => {
    if (!models) {
      loadModels();
    }
  }, [models, loadModels]);

  const filteredModels = useMemo(() => {
    const enabledModels = effectiveModels.filter((m) => m.enabled);
    if (!searchQuery) return enabledModels;
    const q = searchQuery.toLowerCase();
    return enabledModels.filter((m) =>
      (m.display_name || m.id).toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      m.provider_name?.toLowerCase().includes(q),
    );
  }, [effectiveModels, searchQuery]);

  const modelsByProvider: Record<string, typeof filteredModels> = {};
  for (const m of filteredModels) {
    const key = m.provider_name || m.provider_id;
    if (!modelsByProvider[key]) modelsByProvider[key] = [];
    modelsByProvider[key].push(m);
  }

  return (
    <Flexbox gap={0}>
      {/* Search bar */}
      <div style={{ padding: '8px 8px 4px' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 8,
            border: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
          }}
        >
          <Search size={14} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('provider.modelSelect.searchPlaceholder')}
            autoFocus
            style={{
              border: 'none', outline: 'none', flex: 1, fontSize: 13,
              background: 'transparent', color: token.colorText,
            }}
          />
          {searchQuery && (
            <X
              size={14}
              style={{ color: token.colorTextQuaternary, cursor: 'pointer', flexShrink: 0 }}
              onClick={() => setSearchQuery('')}
            />
          )}
        </div>
      </div>

      {/* Model list */}
      <div style={{ maxHeight: 400, overflow: 'auto', padding: '4px 0', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
        {showSkeleton ? (
          <div style={{ padding: '8px 12px' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Flexbox key={i} horizontal align="center" gap={10} style={{ padding: '7px 0' }}>
                <Skeleton.Avatar active size={20} shape="circle" />
                <Skeleton.Input active size="small" style={{ width: 140, height: 16 }} />
              </Flexbox>
            ))}
          </div>
        ) : (
          <>
            {Object.entries(modelsByProvider).map(([provName, provModels]) => (
              <div key={provName}>
                <div
                  style={{
                    padding: '10px 12px 4px',
                    fontSize: 12,
                    color: token.colorTextSecondary,
                    fontWeight: 500,
                  }}
                >
                  {provName}
                </div>
                {provModels.map((m) => (
                  <div
                    key={m.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      onSelect(m.id, m.provider_id);
                      onClose();
                    }}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      padding: '7px 12px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                      margin: '0 4px',
                      background: m.id === currentId ? token.colorPrimaryBg : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (m.id !== currentId) e.currentTarget.style.background = token.colorFillTertiary;
                    }}
                    onMouseLeave={(e) => {
                      if (m.id !== currentId) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <ProviderIcon providerId={m.provider_id || ''} providerName={m.provider_name} size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: m.id === currentId ? 500 : 400 }}>
                        {m.display_name || m.id}
                      </div>
                    </div>
                    <Flexbox horizontal align="center" gap={4} style={{ flexShrink: 0 }}>
                      {m.vision && (
                        <Tooltip title={t('provider.model.capability.vision')}><Eye size={13} style={{ color: token.colorTextQuaternary }} /></Tooltip>
                      )}
                      {m.function_call && (
                        <Tooltip title={t('provider.model.capability.toolUse')}><Wrench size={13} style={{ color: token.colorTextQuaternary }} /></Tooltip>
                      )}
                      {m.reasoning && (
                        <Tooltip title={t('provider.model.capability.deepThinking')}><Sparkles size={13} style={{ color: token.colorTextQuaternary }} /></Tooltip>
                      )}
                      {m.search && (
                        <Tooltip title={t('provider.model.capability.builtInSearch')}><Globe size={13} style={{ color: token.colorTextQuaternary }} /></Tooltip>
                      )}
                      {m.image_output && (
                        <Tooltip title={t('provider.model.capability.imageOutput')}><Image size={13} style={{ color: token.colorTextQuaternary }} /></Tooltip>
                      )}
                      {m.context_window > 0 && (
                        <span style={{ fontSize: 11, color: token.colorTextQuaternary, fontVariantNumeric: 'tabular-nums', marginLeft: 2 }}>
                          {formatContextWindow(m.context_window)}
                        </span>
                      )}
                      {m.id === currentId && (
                        <Check size={14} style={{ color: token.colorPrimary, marginLeft: 2 }} />
                      )}
                    </Flexbox>
                  </div>
                ))}
              </div>
            ))}
            {filteredModels.length === 0 && (
              <Flexbox align="center" gap={8} style={{ padding: 16, textAlign: 'center' }}>
                <div style={{ color: token.colorTextDescription, fontSize: 13 }}>
                  {searchQuery ? t('provider.modelSelect.noMatch') : t('provider.modelSelect.noModels')}
                </div>
                {!searchQuery && onNavigateSettings && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      onClose();
                      onNavigateSettings();
                    }}
                    style={{
                      fontSize: 13,
                      color: token.colorPrimary,
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {t('provider.modelSelect.configureProviders')}
                  </div>
                )}
              </Flexbox>
            )}
          </>
        )}
      </div>

      {onNavigateSettings && (
        <>
          <Divider style={{ margin: 0 }} />
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              onClose();
              onNavigateSettings();
            }}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              padding: '8px 12px',
              margin: 4,
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = token.colorFillTertiary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Settings size={18} />
            </div>
            <div style={{ flex: 1, fontSize: 13 }}>{t('provider.modelSelect.manageProvider')}</div>
            <ChevronRight size={16} style={{ opacity: 0.5 }} />
          </div>
        </>
      )}
    </Flexbox>
  );
}
