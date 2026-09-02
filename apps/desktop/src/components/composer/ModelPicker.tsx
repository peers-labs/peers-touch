import { useMemo, useState, useRef, useCallback, type ChangeEvent } from 'react';
import type { InputRef, MenuProps } from 'antd';
import { Dropdown, Input, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '../../store/agent';
import type { AvailableModel } from '../../services/desktop_api';
import { ProviderIcon } from '../settings/ProviderIcon';
import {
  modelMenuIconStyle,
  modelMenuItemStyle,
  modelMenuLabelStyle,
  modelMenuTextStyle,
} from './modelPickerLayout';

const COMPOSER_COLORS = {
  textTertiary: '#9b9b9b',
} as const;

function modelMenuKey(model: AvailableModel): string {
  return `${encodeURIComponent(model.provider_id || '')}/${encodeURIComponent(model.id)}`;
}

/**
 * Model/provider dropdown allowing users to switch the active model.
 * Reads from useAgentStore; placed in the composer footer between actions and send.
 */
export function ModelPicker() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<InputRef>(null);

  const selectedModel = useAgentStore(s => s.selectedModel);
  const selectedProviderId = useAgentStore(s => s.selectedProviderId);
  const defaultModel = useAgentStore(s => s.defaultModel);
  const availableModels = useAgentStore(s => s.availableModels);
  const setSelectedModel = useAgentStore(s => s.setSelectedModel);

  const currentModelId = selectedModel || defaultModel;
  const modelInfo =
    availableModels.find((m) => m.id === currentModelId && (!selectedProviderId || m.provider_id === selectedProviderId)) ||
    availableModels.find((m) => m.id === currentModelId);
  const currentModelKey = modelInfo ? modelMenuKey(modelInfo) : currentModelId;

  const modelDisplayName = modelInfo?.display_name || modelInfo?.id || currentModelId;
  const modelLabel = modelInfo ? modelDisplayName : currentModelId || t('chat.model.select');

  const modelMenu = useMemo<MenuProps>(() => {
    const term = search.trim().toLowerCase();
    const groups = new Map<string, AvailableModel[]>();
    for (const model of availableModels) {
      if (!model.enabled) continue;
      if (term) {
        const name = (model.display_name || model.id).toLowerCase();
        const provider = (model.provider_name || model.provider_id || '').toLowerCase();
        if (!name.includes(term) && !provider.includes(term)) continue;
      }
      const key = model.provider_name || model.provider_id || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(model);
    }
    return {
      selectedKeys: currentModelKey ? [currentModelKey] : [],
      style: {
        maxHeight: 320,
        minHeight: 320,
        overflowY: 'auto',
        padding: '4px 0',
        border: 'none',
        boxShadow: 'none',
        borderRadius: 0,
        background: 'transparent',
      },
      items: Array.from(groups.entries()).map(([provider, items]) => ({
        key: `group-${provider}`,
        type: 'group' as const,
        label: (
          <Flexbox horizontal align="center" gap={6}>
            <ProviderIcon
              providerId={items[0]?.provider_id || ''}
              providerName={provider}
              size={14}
            />
            <span style={{ fontSize: 11, color: token.colorTextTertiary, fontWeight: 500 }}>
              {provider}
            </span>
          </Flexbox>
        ),
        children: items.map((model) => ({
          key: modelMenuKey(model),
          style: modelMenuItemStyle,
          label: (
            <Flexbox horizontal align="center" gap={8} style={modelMenuLabelStyle}>
              <span style={modelMenuIconStyle}>
                <ProviderIcon
                  providerId={model.provider_id || ''}
                  providerName={model.provider_name}
                  size={18}
                />
              </span>
              <span title={model.display_name || model.id} style={modelMenuTextStyle}>
                {model.display_name || model.id}
              </span>
            </Flexbox>
          ),
        })),
      })),
      onClick: ({ key }) => {
        const next = availableModels.find((model) => modelMenuKey(model) === key);
        if (next) {
          setSelectedModel(next.id, next.provider_id);
          setOpen(false);
          setSearch('');
        }
      },
    };
  }, [availableModels, currentModelKey, setSelectedModel, token.colorTextTertiary, search]);

  const dropdownRender = useCallback((menu: React.ReactNode) => (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
        overflow: 'hidden',
        width: 260,
      }}
    >
      <div style={{ padding: '8px 10px 6px' }}>
        <Input
          ref={searchInputRef}
          prefix={<Search size={14} color={token.colorTextQuaternary} />}
          placeholder={t('chat.model.search', 'Search models...')}
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          variant="borderless"
          size="small"
          autoFocus
          style={{ fontSize: 13 }}
        />
      </div>
      <div style={{ height: 1, background: token.colorFillQuaternary, margin: '0 10px' }} />
      {menu}
    </div>
  ), [search, t, token.colorFillQuaternary, token.colorTextQuaternary]);

  return (
    <div style={{ minWidth: 0, display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
      <Dropdown
        menu={modelMenu}
        trigger={['click']}
        placement="topRight"
        arrow={false}
        open={open}
        onOpenChange={(visible) => {
          setOpen(visible);
          if (!visible) setSearch('');
          if (visible) setTimeout(() => searchInputRef.current?.focus(), 50);
        }}
        dropdownRender={dropdownRender}
        overlayStyle={{ padding: 0, border: 'none', borderRadius: 12, boxShadow: 'none' }}
      >
        <button
          type="button"
          style={{
            height: 28,
            border: 0,
            background: 'transparent',
            color: token.colorTextSecondary,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 13,
            cursor: 'pointer',
            padding: '0 4px',
            maxWidth: '100%',
            lineHeight: 1,
            borderRadius: 6,
          }}
        >
          {modelInfo && (
            <span style={modelMenuIconStyle}>
              <ProviderIcon
                providerId={modelInfo.provider_id || ''}
                providerName={modelInfo.provider_name}
                size={16}
              />
            </span>
          )}
          <span title={modelLabel} style={{ ...modelMenuTextStyle, lineHeight: 1 }}>
            {modelLabel}
          </span>
          {open
            ? <ChevronUp size={12} color={COMPOSER_COLORS.textTertiary} style={{ flexShrink: 0 }} />
            : <ChevronDown size={12} color={COMPOSER_COLORS.textTertiary} style={{ flexShrink: 0 }} />
          }
        </button>
      </Dropdown>
    </div>
  );
}
