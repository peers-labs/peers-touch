import type { ReactNode } from 'react';
import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
  type ChangeEvent,
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, Popover } from '@lobehub/ui';
import { ProviderIcon } from './settings/ProviderIcon';
import {
  Send,
  Square,
  Paperclip,
  X,
  Globe,
  GlobeOff,
  Blocks,
  ChevronRight,
  ChevronDown,
  Settings2,
  Sparkles,
  CircleOff,
  Type as TypeIcon,
  Eraser,
  Brain,
  BrainCircuit,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  SquareCode,
  Timer,
  TimerOff,
  MessageSquarePlus,
  GalleryVerticalEnd,
  Search,
  Mic,
  MicOff,
  FileText,
  RefreshCcw,
} from 'lucide-react';
import { theme, Divider, Popconfirm, Slider, Switch, Modal, Tabs, Empty, Progress } from 'antd';
import { Tag, toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../store/chat';
import type { ChatComposerAttachment } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { useSkillStore } from '../store/skill';
import { ModelProviderSelect } from './ModelProviderSelect';
import { api, type BuiltinSkillInfo, type SkillListItem } from '../services/desktop_api';
import { SkillAppletPopoverContent } from './SkillAppletSelector';
import { estimateTokenCount } from 'tokenx';
import { log } from '../utils/logger';
import {
  useChatAttachmentDrafts,
  type ChatDraftAttachment,
} from './chat/composer/useChatAttachmentDrafts';
import { LazyMarkdown as Markdown } from './LazyMarkdown';

function Action({
  icon, title, onClick, disabled, active, color, style,
}: {
  icon: ReactNode; title?: string; onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean; active?: boolean; color?: string; style?: CSSProperties;
}) {
  const { token } = theme.useToken();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 36, height: 36, borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: active ? token.colorPrimaryBg : hovered ? token.colorFillSecondary : 'transparent',
        color: color ? color : active ? token.colorPrimary : disabled ? token.colorTextQuaternary : token.colorTextSecondary,
        transition: 'all 0.2s', flexShrink: 0, ...style,
      }}
    >
      {icon}
    </div>
  );
}

function browserSpeechLanguage(language?: string): string {
  if (!language || language === 'auto') return '';
  return language;
}

// ── Model Detail Panel (LobeChat-style) ──────────────────────────────

function ModelDetailPanel({ modelId }: { modelId: string }) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const { availableModels, selectedAgent, agents } = useAgentStore();
  const model = availableModels.find((m) => m.id === modelId);
  const currentAgent = agents.find((a) => a.name === selectedAgent);
  const chatConfig = currentAgent ? (() => { try { return JSON.parse(currentAgent.chatConfig || '{}'); } catch { return {}; } })() : {};
  const agentParams = currentAgent ? (() => { try { return JSON.parse(currentAgent.params || '{}'); } catch { return {}; } })() : {};

  const contextWindow = model?.context_window || 0;
  const formatTokens = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
    return String(n);
  };

  const updateConfig = (key: string, value: any) => {
    if (!currentAgent) return;
    useAgentStore.getState().updateAgentConfig(currentAgent.name, {
      chatConfig: { ...chatConfig, [key]: value },
    });
  };

  const updateParams = (key: string, value: any) => {
    if (!currentAgent) return;
    useAgentStore.getState().updateAgentConfig(currentAgent.name, {
      params: { ...agentParams, [key]: value },
    });
  };

  return (
    <Flexbox gap={0} style={{ padding: 12 }}>
      {/* Header */}
      <Flexbox horizontal align="center" gap={10} style={{ marginBottom: 8 }}>
        <ProviderIcon providerId={model?.provider_id || ''} providerName={model?.provider_name || modelId} size={28} />
        <Flexbox>
          <span style={{ fontSize: 15, fontWeight: 700, color: token.colorText }}>
            {model?.display_name || modelId}
          </span>
          {model?.provider_name && (
            <span style={{ fontSize: 11, color: token.colorTextDescription }}>
              {model.provider_name}
            </span>
          )}
        </Flexbox>
      </Flexbox>

      {/* Context Length — single row */}
      <Flexbox horizontal align="center" justify="space-between" style={{ padding: '6px 0' }}>
        <Flexbox horizontal align="center" gap={6}>
          <div style={{ width: 3, height: 12, borderRadius: 2, background: '#1677ff' }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: token.colorTextSecondary }}>{t('chat.model.contextLength')}</span>
        </Flexbox>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {contextWindow > 0 ? String(t('chat.model.tokensUnit', { count: formatTokens(contextWindow) } as any)) : '∞'}
        </span>
      </Flexbox>

      <Divider style={{ margin: '4px 0' }} />

      {/* Model Config */}
      <Flexbox horizontal align="center" gap={6} style={{ padding: '6px 0 4px' }}>
        <div style={{ width: 3, height: 12, borderRadius: 2, background: '#52c41a' }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: token.colorTextSecondary }}>{t('chat.model.config')}</span>
      </Flexbox>
      <Flexbox gap={8} style={{ padding: '2px 0 4px' }}>
        {[
          { label: t('chat.model.temperature'), key: 'temperature', min: 0, max: 2, step: 0.1, def: 0.6 },
          { label: t('chat.model.topP'), key: 'top_p', min: 0, max: 1, step: 0.05, def: 1 },
          { label: t('chat.model.frequencyPenalty'), key: 'frequency_penalty', min: -2, max: 2, step: 0.1, def: 0 },
          { label: t('chat.model.presencePenalty'), key: 'presence_penalty', min: -2, max: 2, step: 0.1, def: 0 },
        ].map(({ label, key, min, max, step, def }) => (
          <Flexbox key={key} gap={0}>
            <Flexbox horizontal justify="space-between" align="center">
              <span style={{ fontSize: 12, color: token.colorText }}>{label}</span>
              <span style={{ fontSize: 12, color: token.colorTextDescription, fontVariantNumeric: 'tabular-nums' }}>
                {agentParams[key] ?? def}
              </span>
            </Flexbox>
            <Slider
              min={min} max={max} step={step}
              value={agentParams[key] ?? def}
              onChange={(v) => updateParams(key, v)}
              style={{ margin: '4px 0' }}
            />
          </Flexbox>
        ))}

        <Flexbox horizontal justify="space-between" align="center">
          <span style={{ fontSize: 12, color: token.colorText }}>{t('chat.model.contextCompression')}</span>
          <Switch
            size="small"
            checked={chatConfig.enableContextCompression ?? false}
            onChange={(v) => updateConfig('enableContextCompression', v)}
          />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}

// ── Search Controls (Off / Auto / Model built-in) ────────────────────

function SearchControls() {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const { enabledAppletIds, toggleApplet } = useAgentStore();
  const isEnabled = enabledAppletIds.includes('web-search');
  const [useModelSearch, setUseModelSearch] = useState(false);

  const mode = isEnabled ? 'auto' : 'off';

  const setMode = (m: 'off' | 'auto') => {
    if (m === 'auto' && !isEnabled) toggleApplet('web-search');
    if (m === 'off' && isEnabled) toggleApplet('web-search');
  };

  return (
    <Flexbox gap={4} style={{ padding: 8, minWidth: 280 }}>
      {/* Off */}
      <div
        role="button" tabIndex={0}
        onClick={() => setMode('off')}
        style={{
          display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px',
          borderRadius: 8, cursor: 'pointer', transition: 'background 0.15s',
          background: mode === 'off' ? token.colorFillSecondary : 'transparent',
        }}
        onMouseEnter={(e) => { if (mode !== 'off') e.currentTarget.style.background = token.colorFillQuaternary; }}
        onMouseLeave={(e) => { if (mode !== 'off') e.currentTarget.style.background = 'transparent'; }}
      >
        <GlobeOff size={20} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{t('chat.search.off')}</div>
          <div style={{ fontSize: 12, color: token.colorTextDescription }}>{t('chat.search.offDesc')}</div>
        </div>
      </div>

      {/* Auto */}
      <div
        role="button" tabIndex={0}
        onClick={() => setMode('auto')}
        style={{
          display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px',
          borderRadius: 8, cursor: 'pointer', transition: 'background 0.15s',
          background: mode === 'auto' ? token.colorFillSecondary : 'transparent',
        }}
        onMouseEnter={(e) => { if (mode !== 'auto') e.currentTarget.style.background = token.colorFillQuaternary; }}
        onMouseLeave={(e) => { if (mode !== 'auto') e.currentTarget.style.background = 'transparent'; }}
      >
        <Sparkles size={20} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{t('chat.search.auto')}</div>
          <div style={{ fontSize: 12, color: token.colorTextDescription }}>{t('chat.search.autoDesc')}</div>
        </div>
      </div>

      {/* Model built-in web search */}
      {mode !== 'off' && (
        <>
          <Divider style={{ margin: '4px 0' }} />
          <Flexbox horizontal align="center" justify="space-between" style={{ padding: '6px 12px' }}>
            <Flexbox horizontal align="center" gap={8}>
              <Globe size={18} style={{ color: token.colorTextSecondary }} />
              <span style={{ fontSize: 13 }}>{t('chat.search.useModelSearch')}</span>
            </Flexbox>
            <Switch size="small" checked={useModelSearch} onChange={setUseModelSearch} />
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
}

// ── Token Counting Hook ──────────────────────────────────────────────
// Uses tokenx (same lib as LobeChat) for heuristic token estimation.
// 300ms debounce to avoid heavy recalculations while typing.

function useTokenCount(input: string): number {
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!input) { setCount(0); return; }
      try {
        const n = estimateTokenCount(input);
        setCount(n);
      } catch {
        setCount(Math.ceil(input.length / 4));
      }
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [input]);

  return count;
}

function isSupportedComposerFile(file: File): boolean {
  const mimeType = file.type || 'application/octet-stream';
  const name = file.name.toLowerCase();
  return mimeType.startsWith('image/')
    || mimeType === 'application/pdf'
    || mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || name.endsWith('.md')
    || name.endsWith('.csv');
}

function formatAttachmentSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

// ── History Controls (persisted to agent chatConfig) ─────────────────

function HistoryControls() {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const { selectedAgent, updateAgentConfig, getCurrentAgentChatConfig } = useAgentStore();
  const chatConfig = getCurrentAgentChatConfig();

  const [enabled, setEnabled] = useState(chatConfig.enableHistoryCount ?? true);
  const [count, setCount] = useState(chatConfig.historyCount ?? 20);

  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback((enableHistoryCount: boolean, historyCount: number) => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      updateAgentConfig(selectedAgent, { chatConfig: { enableHistoryCount, historyCount } });
    }, 500);
  }, [selectedAgent, updateAgentConfig]);

  return (
    <Flexbox gap={12} style={{ padding: 12, minWidth: 240 }}>
      <Flexbox horizontal align="center" justify="space-between">
        <span style={{ fontSize: 13, fontWeight: 500 }}>{t('chat.history.limitMessages')}</span>
        <Switch size="small" checked={enabled}
          onChange={(v) => { setEnabled(v); save(v, count); }}
        />
      </Flexbox>
      <Flexbox gap={4}>
        <Flexbox horizontal align="center" justify="space-between">
          <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('chat.history.messageCount')}</span>
          <span style={{ fontSize: 12, color: token.colorTextDescription }}>{enabled ? count : '∞'}</span>
        </Flexbox>
        <Slider min={1} max={50} step={1} value={count} onChange={(v) => { setCount(v); save(enabled, v); }}
          disabled={!enabled}
        />
      </Flexbox>
    </Flexbox>
  );
}

// ── Memory Controls (persisted to agent chatConfig.memory) ───────────

function MemoryControls() {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const { selectedAgent, updateAgentConfig, getCurrentAgentChatConfig } = useAgentStore();
  const chatConfig = getCurrentAgentChatConfig();
  const memCfg = chatConfig.memory ?? {};

  const enabled = memCfg.enabled ?? false;
  const effort = memCfg.effort ?? 'medium';

  const effortLevels = ['low', 'medium', 'high'] as const;
  const effortIndex = effortLevels.indexOf(effort as typeof effortLevels[number]);

  const setMemory = (updates: { enabled?: boolean; effort?: 'low' | 'medium' | 'high' }) => {
    updateAgentConfig(selectedAgent, {
      chatConfig: { memory: { ...memCfg, ...updates } },
    });
  };

  const toggleOptions = [
    {
      value: false,
      icon: CircleOff,
      label: t('chat.memory.disableTitle'),
      desc: t('chat.memory.disableDesc'),
    },
    {
      value: true,
      icon: BrainCircuit,
      label: t('chat.memory.enableTitle'),
      desc: t('chat.memory.enableDesc'),
    },
  ];

  return (
    <Flexbox gap={4} style={{ padding: 4, minWidth: 320 }}>
      {toggleOptions.map((opt) => {
        const isActive = enabled === opt.value;
        const Icon = opt.icon;
        return (
          <Flexbox
            key={opt.label}
            horizontal
            align="flex-start"
            gap={12}
            onClick={() => setMemory({ enabled: opt.value })}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              cursor: 'pointer',
              transition: 'background 0.15s',
              background: isActive ? token.colorFillSecondary : 'transparent',
            }}
            onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = token.colorFillQuaternary; }}
            onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isActive ? token.colorPrimaryBg : token.colorFillTertiary,
              color: isActive ? token.colorPrimary : token.colorTextSecondary,
            }}>
              <Icon size={16} />
            </div>
            <Flexbox>
              <span style={{ fontSize: 13, fontWeight: 500, color: token.colorText }}>{opt.label}</span>
              <span style={{ fontSize: 11, color: token.colorTextDescription, lineHeight: 1.4 }}>{opt.desc}</span>
            </Flexbox>
          </Flexbox>
        );
      })}

      {enabled && (
        <>
          <Divider style={{ margin: 0 }} />
          <Flexbox horizontal align="center" gap={16} style={{ padding: 8 }}>
            <Flexbox style={{ minWidth: 100, flex: 1 }} gap={4}>
              <span style={{ fontSize: 13, fontWeight: 500, color: token.colorText }}>{t('chat.memory.aggressiveness')}</span>
              <span style={{ fontSize: 11, color: token.colorTextDescription, lineHeight: 1.4 }}>
                {t('chat.memory.aggressivenessDesc')}
              </span>
            </Flexbox>
            <Flexbox style={{ flex: 1, minWidth: 160 }}>
              <Slider
                min={0} max={2} step={1}
                value={effortIndex >= 0 ? effortIndex : 1}
                marks={{ 0: t('chat.memory.low'), 1: t('chat.memory.medium'), 2: t('chat.memory.high') }}
                tooltip={{ open: false }}
                onChange={(v) => setMemory({ effort: effortLevels[v], enabled: true })}
              />
            </Flexbox>
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
}

// ── Token Usage Display ──────────────────────────────────────────────
// Uses tokenx (same as LobeChat) for estimation. Context window is
// model-dependent, sourced from the model registry via availableModels.

function TokenDisplay({ inputText }: { inputText: string }) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const { messages } = useChatStore();
  const { availableModels, selectedModel, defaultModel, agents, selectedAgent } = useAgentStore();

  const modelId = selectedModel || defaultModel;
  const modelInfo = availableModels.find((m) => m.id === modelId);
  const contextWindow = modelInfo?.context_window || 0;

  const agent = agents.find((a) => a.name === selectedAgent);
  const systemRole = agent?.systemPrompt || '';

  const chatsString = useMemo(() =>
    messages.map((m) => m.content).join('\n'),
  [messages]);

  const systemTokens = useTokenCount(systemRole);
  const chatsTokens = useTokenCount(chatsString);
  const inputTokens = useTokenCount(inputText);

  const totalTokens = systemTokens + chatsTokens + inputTokens;

  if (!contextWindow) return null;

  const remaining = Math.max(0, contextWindow - totalTokens);
  const pct = Math.min(100, Math.round((totalTokens / contextWindow) * 100));
  const overloaded = totalTokens > contextWindow;

  const popoverContent = (
    <Flexbox gap={8} style={{ padding: 12, minWidth: 240 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>{t('chat.token.contextUsage')}</div>
      <Progress percent={pct} size="small" strokeColor={overloaded ? token.colorError : pct > 80 ? token.colorWarning : token.colorPrimary} showInfo={false} />

      {[{ label: t('chat.token.systemPrompt'), value: systemTokens, color: '#7265e6' },
        { label: t('chat.token.chatMessages'), value: chatsTokens, color: '#1677ff' },
        { label: t('chat.token.currentInput'), value: inputTokens, color: '#52c41a' }].map((item) => (
        <Flexbox key={item.label} horizontal align="center" justify="space-between">
          <Flexbox horizontal align="center" gap={6}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: item.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{item.label}</span>
          </Flexbox>
          <span style={{ fontSize: 12, color: token.colorTextDescription, fontVariantNumeric: 'tabular-nums' }}>
            {item.value.toLocaleString()}
          </span>
        </Flexbox>
      ))}

      <Divider style={{ margin: '4px 0' }} />
      <Flexbox horizontal align="center" justify="space-between">
        <span style={{ fontSize: 12, fontWeight: 500 }}>{t('chat.token.totalUsed')}</span>
        <span style={{ fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{totalTokens.toLocaleString()}</span>
      </Flexbox>
      <Flexbox horizontal align="center" justify="space-between">
        <span style={{ fontSize: 12, color: overloaded ? token.colorError : token.colorTextSecondary }}>
          {overloaded ? t('chat.token.overloaded') : t('chat.token.remaining')}
        </span>
        <span style={{ fontSize: 12, color: overloaded ? token.colorError : token.colorSuccess, fontVariantNumeric: 'tabular-nums' }}>
          {overloaded ? `-${(totalTokens - contextWindow).toLocaleString()}` : remaining.toLocaleString()}
        </span>
      </Flexbox>
    </Flexbox>
  );

  return (
    <Popover content={popoverContent} placement="topRight" styles={{ content: { padding: 0 } }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px',
        borderRadius: 6, fontSize: 11, cursor: 'pointer',
        color: overloaded ? token.colorError : pct > 80 ? token.colorWarning : token.colorTextDescription,
        background: token.colorFillQuaternary,
        fontVariantNumeric: 'tabular-nums',
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: 3,
          background: overloaded ? token.colorError : pct > 80 ? token.colorWarning : token.colorSuccess,
        }} />
        {totalTokens.toLocaleString()} / {contextWindow.toLocaleString()}
      </div>
    </Popover>
  );
}

// ── Skills Dialog ────────────────────────────────────────────────────

// ── SkillsDialog ─────────────────────────────────────────────────────
//
// Search strategy (hybrid, frontend + backend collaboration):
//
//   Frontend (instant, client-side):
//     - On open, fetches full skill list from GET /api/skills (builtin + custom)
//     - While user types, filters the loaded list by substring match on
//       name/description/tags — zero latency, good for ≤100 skills
//     - This runs on every keystroke (no debounce needed for local filter)
//
//   Backend (BM25, server-side):
//     - When query length ≥ 2 chars, debounced 300ms, calls GET /api/skills/search?q=xxx
//     - Backend performs SQLite FTS5 BM25-ranked search on skill_fts table
//       (indexes: name, description, content, keywords)
//     - Returns ranked results that may include matches inside skill content
//       (which client-side filter can't see)
//     - Results merged with client-side matches, deduplicated by id
//
//   When frontend works alone:
//     - Query is empty or only 1 char → show all, filtered client-side
//     - Query has no matches client-side but backend returns results → show backend results
//
//   When backend is needed:
//     - Deep content search (searching within skill markdown instructions)
//     - Large skill sets (>100 custom skills)
//     - BM25 relevance ranking (better than substring for multi-word queries)

function SkillsDialog({ open, onClose, onNavigateSkillSettings }: {
  open: boolean; onClose: () => void; onNavigateSkillSettings: () => void;
}) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const { skills, builtins, loadSkills, toggleSkill } = useSkillStore();
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [backendResults, setBackendResults] = useState<SkillListItem[] | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSearchQuery('');
    setBackendResults(null);
    loadSkills().catch(() => {}).finally(() => setLoading(false));
  }, [open, loadSkills]);

  // Backend BM25 search (debounced 300ms, triggered when query ≥ 2 chars)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (searchQuery.length < 2) {
      setBackendResults(null);
      return;
    }
    searchTimerRef.current = setTimeout(() => {
      api.searchSkills(searchQuery, 50).then((data) => {
        setBackendResults(data.skills);
      }).catch(() => setBackendResults(null));
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // Client-side fuzzy filter: instant substring match on name/description/tags
  const clientFilter = useCallback((items: Array<{ name?: string; description?: string; metaTitle?: string; metaTags?: string[]; identifier?: string }>) => {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((s) => {
      const name = ((s as any).metaTitle || s.name || s.identifier || '').toLowerCase();
      const desc = (s.description || '').toLowerCase();
      const tags = ((s as any).metaTags || []).join(' ').toLowerCase();
      return name.includes(q) || desc.includes(q) || tags.includes(q);
    });
  }, [searchQuery]);

  // Merge client-side + backend results for custom skills, deduplicated
  const filteredSkills = useMemo(() => {
    const clientMatches = clientFilter(skills) as SkillListItem[];
    if (!backendResults) return clientMatches;
    const ids = new Set(clientMatches.map((s) => s.id));
    const merged = [...clientMatches];
    for (const br of backendResults) {
      if (!ids.has(br.id)) {
        merged.push(br);
        ids.add(br.id);
      }
    }
    return merged;
  }, [skills, backendResults, clientFilter]);

  const filteredBuiltins = useMemo(() => clientFilter(builtins) as BuiltinSkillInfo[], [builtins, clientFilter]);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await toggleSkill(id, enabled);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Selected skill for preview panel
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const handleSelectSkill = useCallback(async (id: string, isBuiltin?: boolean) => {
    if (selectedSkillId === id) {
      setSelectedSkillId(null);
      return;
    }
    setSelectedSkillId(id);
    if (isBuiltin) {
      setPreviewContent(t('chat.skills.builtinHint'));
      return;
    }
    setPreviewLoading(true);
    try {
      const detail = await api.getSkill(id);
      setPreviewContent(detail.content || t('chat.skills.noContent'));
    } catch {
      setPreviewContent(t('chat.skills.loadFailed'));
    }
    setPreviewLoading(false);
  }, [selectedSkillId]);

  const hasPreview = selectedSkillId !== null;

  return (
    <Modal
      open={open}
      onCancel={() => { onClose(); setSelectedSkillId(null); }}
      title={
        <Flexbox horizontal align="center" justify="space-between" style={{ paddingRight: 24 }}>
          <span>{t('chat.skills.title')}</span>
          <ActionIcon
            icon={Settings2}
            size="small"
            title={t('chat.skills.settings')}
            onClick={() => { onClose(); onNavigateSkillSettings(); }}
          />
        </Flexbox>
      }
      footer={null}
      width={hasPreview ? 880 : 520}
      styles={{
        body: { padding: 0, display: 'flex', height: 480, overflow: 'hidden' },
      }}
    >
      <Flexbox horizontal style={{ height: '100%', flex: 1, minHeight: 0 }}>
        {/* Left: skill list (scrollable body, fixed header) */}
        <Flexbox style={{ width: hasPreview ? 440 : '100%', minWidth: 0, height: '100%', transition: 'width 0.2s' }}>
          {/* Fixed: search bar */}
          <div style={{ padding: '12px 16px 8px', flexShrink: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 8,
              border: `1px solid ${token.colorBorder}`,
              background: token.colorBgContainer,
            }}>
              <Search size={14} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('chat.skills.searchPlaceholder')}
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

          {/* Fixed: tabs header */}
          <Tabs
            defaultActiveKey="builtin"
            style={{ padding: '0 16px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
            items={[
              {
                key: 'builtin',
                label: t('chat.skills.tab.builtin', { count: filteredBuiltins.length }),
                children: (
                  <div style={{ overflow: 'auto', flex: 1, maxHeight: 360, paddingBottom: 8 }}>
                    <Flexbox gap={4}>
                      {filteredBuiltins.length === 0 && !loading && (
                        <Empty description={searchQuery ? t('chat.skills.builtinNoMatch') : t('chat.skills.builtinEmpty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      )}
                      {filteredBuiltins.map((s) => (
                        <Flexbox
                          key={s.identifier}
                          horizontal align="center" gap={10}
                          onClick={() => handleSelectSkill(s.identifier, true)}
                          style={{
                            padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                            background: selectedSkillId === s.identifier ? token.colorPrimaryBg : 'transparent',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={(e) => { if (selectedSkillId !== s.identifier) (e.currentTarget as HTMLElement).style.background = token.colorFillTertiary; }}
                          onMouseLeave={(e) => { if (selectedSkillId !== s.identifier) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                        >
                          <div style={{ fontSize: 18, width: 28, textAlign: 'center', flexShrink: 0 }}>{s.avatar || '📋'}</div>
                          <Flexbox flex={1} style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                            <div style={{ fontSize: 11, color: token.colorTextDescription, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.description}
                            </div>
                          </Flexbox>
                          {s.keywords?.length > 0 && (
                            <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>{s.keywords[0]}</Tag>
                          )}
                        </Flexbox>
                      ))}
                    </Flexbox>
                  </div>
                ),
              },
              {
                key: 'custom',
                label: t('chat.skills.tab.custom', { count: filteredSkills.length }),
                children: (
                  <div style={{ overflow: 'auto', flex: 1, maxHeight: 360, paddingBottom: 8 }}>
                    <Flexbox gap={4}>
                      {filteredSkills.length === 0 && !loading && (
                        <Empty description={searchQuery ? t('chat.skills.customNoMatch') : t('chat.skills.customEmpty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      )}
                      {filteredSkills.map((s) => (
                        <Flexbox
                          key={s.id}
                          horizontal align="center" gap={10}
                          onClick={() => handleSelectSkill(s.id)}
                          style={{
                            padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                            background: selectedSkillId === s.id ? token.colorPrimaryBg : 'transparent',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={(e) => { if (selectedSkillId !== s.id) (e.currentTarget as HTMLElement).style.background = token.colorFillTertiary; }}
                          onMouseLeave={(e) => { if (selectedSkillId !== s.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                        >
                          <div style={{ fontSize: 18, width: 28, textAlign: 'center', flexShrink: 0 }}>{s.metaAvatar || '🔧'}</div>
                          <Flexbox flex={1} style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{s.metaTitle || s.name}</div>
                            <div style={{ fontSize: 11, color: token.colorTextDescription, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {s.description}
                            </div>
                          </Flexbox>
                          <Switch size="small" checked={s.enabled} onChange={(v) => { v.valueOf(); handleToggle(s.id, v); }} onClick={(_, e) => e.stopPropagation()} />
                        </Flexbox>
                      ))}
                    </Flexbox>
                  </div>
                ),
              },
            ]}
          />
        </Flexbox>

        {/* Right: preview panel (appears when a skill is selected) */}
        {hasPreview && (
          <Flexbox style={{
            width: 440, flexShrink: 0, height: '100%',
            borderLeft: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgLayout,
          }}>
            <Flexbox horizontal align="center" justify="space-between" style={{
              padding: '12px 16px', flexShrink: 0,
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
            }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t('chat.skills.preview')}</span>
              <X
                size={14}
                style={{ color: token.colorTextTertiary, cursor: 'pointer' }}
                onClick={() => setSelectedSkillId(null)}
              />
            </Flexbox>
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {previewLoading ? (
                <div style={{ color: token.colorTextDescription, fontSize: 13 }}>{t('chat.skills.loading')}</div>
              ) : (
                <Markdown>{previewContent}</Markdown>
              )}
            </div>
          </Flexbox>
        )}
      </Flexbox>
    </Modal>
  );
}

// ── TypoBar ──────────────────────────────────────────────────────────

function TypoBar({ onInsert }: { onInsert: (prefix: string, suffix: string, block?: boolean) => void }) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const items = [
    { icon: <Bold size={16} />, title: t('chat.typoBar.bold'), p: '**', s: '**' },
    { icon: <Italic size={16} />, title: t('chat.typoBar.italic'), p: '*', s: '*' },
    { icon: <Underline size={16} />, title: t('chat.typoBar.underline'), p: '<u>', s: '</u>' },
    { icon: <Strikethrough size={16} />, title: t('chat.typoBar.strikethrough'), p: '~~', s: '~~' },
  ];
  const lists = [
    { icon: <List size={16} />, title: t('chat.typoBar.bulletList'), p: '- ', s: '', b: true },
    { icon: <ListOrdered size={16} />, title: t('chat.typoBar.numberedList'), p: '1. ', s: '', b: true },
    { icon: <ListChecks size={16} />, title: t('chat.typoBar.taskList'), p: '- [ ] ', s: '', b: true },
  ];
  const code = [
    { icon: <Quote size={16} />, title: t('chat.typoBar.blockquote'), p: '> ', s: '', b: true },
    { icon: <Code size={16} />, title: t('chat.typoBar.inlineCode'), p: '`', s: '`' },
    { icon: <SquareCode size={16} />, title: t('chat.typoBar.codeBlock'), p: '```\n', s: '\n```', b: true },
  ];
  return (
    <Flexbox horizontal align="center" gap={2} style={{
      padding: '4px 8px', background: token.colorFillQuaternary,
      borderTopLeftRadius: 8, borderTopRightRadius: 8,
      borderBottom: `1px solid ${token.colorBorderSecondary}`,
    }}>
      {items.map((i) => <Action key={i.title} icon={i.icon} title={i.title} onClick={() => onInsert(i.p, i.s)} style={{ width: 32, height: 32 }} />)}
      <Divider type="vertical" style={{ margin: '0 2px', height: 16 }} />
      {lists.map((i) => <Action key={i.title} icon={i.icon} title={i.title} onClick={() => onInsert(i.p, i.s, i.b)} style={{ width: 32, height: 32 }} />)}
      <Divider type="vertical" style={{ margin: '0 2px', height: 16 }} />
      {code.map((i) => <Action key={i.title} icon={i.icon} title={i.title} onClick={() => onInsert(i.p, i.s, i.b)} style={{ width: 32, height: 32 }} />)}
    </Flexbox>
  );
}

// ── Action Keys for configurable toolbar ─────────────────────────────

export type ActionKey = 'model' | 'search' | 'memory' | 'upload' | 'voice' | 'tools' | 'divider' | 'more' | 'token';

export const DEFAULT_LEFT_ACTIONS: ActionKey[] = ['model', 'search', 'memory', 'upload', 'voice', 'tools', 'divider', 'more'];
export const DEFAULT_RIGHT_ACTIONS: ActionKey[] = ['token'];

export interface ChatInputProps {
  onNavigateSettings?: () => void;
  onNavigateApplets?: () => void;
  onNavigateSkills?: () => void;
  leftActions?: ActionKey[];
  rightActions?: ActionKey[];
  compact?: boolean;
  placeholder?: string;
}

type ComposerReferenceKind = 'command' | 'agent' | 'message';

interface ComposerReference {
  kind: ComposerReferenceKind;
  id: string;
  label: string;
  token: string;
}

interface ComposerSuggestion extends ComposerReference {
  description: string;
  icon: ReactNode;
}

function findComposerTrigger(input: string): { kind: ComposerReferenceKind; query: string; start: number; end: number } | null {
  const match = input.match(/(^|\s)([\/@#])([^\s]*)$/);
  if (!match) return null;
  const symbol = match[2];
  const kind: ComposerReferenceKind = symbol === '/' ? 'command' : symbol === '@' ? 'agent' : 'message';
  const start = input.length - match[2].length - match[3].length;
  return { kind, query: match[3].toLowerCase(), start, end: input.length };
}

function formatMessageSnippet(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 72);
}

function ComposerSuggestionPanel({
  suggestions,
  onSelect,
}: {
  suggestions: ComposerSuggestion[];
  onSelect: (suggestion: ComposerSuggestion) => void;
}) {
  const { token } = theme.useToken();
  if (suggestions.length === 0) return null;
  return (
    <Flexbox
      gap={4}
      style={{
        marginBottom: 8,
        padding: 8,
        borderRadius: 10,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
      }}
    >
      {suggestions.map((item) => (
        <button
          key={`${item.kind}:${item.id}`}
          type="button"
          onClick={() => onSelect(item)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '7px 8px',
            border: 0,
            borderRadius: 8,
            background: token.colorBgContainer,
            color: token.colorText,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ display: 'flex', color: token.colorTextSecondary }}>{item.icon}</span>
          <Flexbox style={{ minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{item.label}</span>
            <span style={{ fontSize: 11, color: token.colorTextDescription, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.description}
            </span>
          </Flexbox>
        </button>
      ))}
    </Flexbox>
  );
}

function ComposerAttachmentDraft({
  item,
  onRemove,
  onRetry,
}: {
  item: ChatDraftAttachment;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const isImage = item.mimeType.startsWith('image/') && item.previewUrl;
  return (
    <div
      style={{
        position: 'relative',
        flexShrink: 0,
        width: isImage ? 76 : 180,
        minHeight: 76,
        borderRadius: 10,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        overflow: 'hidden',
      }}
    >
      {isImage ? (
        <img
          src={item.previewUrl || ''}
          alt=""
          style={{ width: '100%', height: 76, objectFit: 'cover', opacity: item.status === 'uploading' ? 0.5 : 1 }}
        />
      ) : (
        <Flexbox horizontal align="center" gap={8} style={{ padding: 10, height: '100%' }}>
          <FileText size={22} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
          <Flexbox style={{ minWidth: 0 }}>
            <span style={{ fontSize: 12, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.name}
            </span>
            <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
              {formatAttachmentSize(item.size)}
            </span>
          </Flexbox>
        </Flexbox>
      )}

      {item.status === 'uploading' && (
        <Flexbox align="center" justify="center" style={{ position: 'absolute', inset: 0, fontSize: 11, color: token.colorTextSecondary, background: token.colorBgMask }}>
          {t('chat.input.attachmentUploading')}
        </Flexbox>
      )}

      {item.status === 'failed' && (
        <button
          type="button"
          onClick={onRetry}
          title={t('chat.input.attachmentRetry')}
          style={{
            position: 'absolute',
            inset: 0,
            border: 0,
            background: token.colorErrorBg,
            color: token.colorError,
            cursor: 'pointer',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <RefreshCcw size={12} />
          {t('chat.input.attachmentRetry')}
        </button>
      )}

      <button
        type="button"
        onClick={onRemove}
        title={t('chat.input.attachmentRemove')}
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 20,
          height: 20,
          borderRadius: '50%',
          border: 'none',
          background: token.colorError,
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        <X size={11} />
      </button>
    </div>
  );
}

// ── Main ChatInput ───────────────────────────────────────────────────

export function ChatInput({
  onNavigateSettings,
  onNavigateApplets,
  onNavigateSkills,
  leftActions = DEFAULT_LEFT_ACTIONS,
  rightActions = DEFAULT_RIGHT_ACTIONS,
  compact = false,
  placeholder: customPlaceholder,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  const [modelOpen, setModelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [showTypoBar, setShowTypoBar] = useState(false);
  const [collapseOpen, setCollapseOpen] = useState(false);
  const [skillsDialogOpen, setSkillsDialogOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [draggingAttachment, setDraggingAttachment] = useState(false);
  const [composerReferences, setComposerReferences] = useState<ComposerReference[]>([]);
  const recognitionRef = useRef<any>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isComposingRef = useRef(false);
  const topicComposerRef = useRef<Record<string, { input: string; collapseOpen: boolean; showTypoBar: boolean }>>({});
  const prevSessionKeyRef = useRef('');

  const handleVoiceInput = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.warning(t('chat.input.voice.unsupported'));
      return;
    }
    const currentVoiceConfig = useAgentStore.getState().getCurrentAgentChatConfig().voice || {};
    if ((currentVoiceConfig.sttProvider ?? 'browser') !== 'browser') {
      toast.warning(t('chat.input.voice.providerUnsupported'));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    const speechLanguage = browserSpeechLanguage(currentVoiceConfig.sttLanguage);
    if (speechLanguage) recognition.lang = speechLanguage;
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
      if (currentVoiceConfig.sttAutoStop && event.results?.[event.results.length - 1]?.isFinal) {
        recognition.stop();
      }
    };

    recognition.onerror = (event: any) => {
      log.error('chat', 'Speech recognition error', { error: event.error });
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (event.error === 'not-allowed') {
        toast.error(t('chat.input.voice.micDenied'));
      }
    };

    recognition.onend = () => {
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };

    setRecordingTime(0);
    recordingTimerRef.current = setInterval(() => {
      setRecordingTime((t) => t + 1);
    }, 1000);
    setIsRecording(true);
    recognition.start();
  }, [isRecording, t]);

  const {
    sendMessage, stopStreaming, isStreaming,
    messages, saveCurrentTopic, currentSessionKey,
  } = useChatStore();
  const {
    selectedModel, defaultModel, enabledAppletIds, availableModels,
    loadModels, loadAgents, loadApplets,
    agents,
    getCurrentAgentChatConfig,
  } = useAgentStore();

  const chatConfig = getCurrentAgentChatConfig();
  const memoryEnabled = chatConfig.memory?.enabled ?? false;
  const historyEnabled = chatConfig.enableHistoryCount ?? true;
  const hasActiveTopic = messages.length > 0;
  const {
    drafts,
    readyAttachments,
    uploading: attachmentUploading,
    failed: attachmentFailed,
    addFiles,
    clearDrafts,
    removeDraft,
    retryDraft,
  } = useChatAttachmentDrafts({
    conversationId: currentSessionKey,
    disabled: isStreaming,
    editing: false,
    fallbackName: t('chat.input.attachmentFallbackName'),
    onUploadFailed: () => toast.error(t('chat.input.attachmentUploadFailed')),
  });

  const addSupportedFiles = useCallback((files: File[]) => {
    const supported = files.filter(isSupportedComposerFile);
    const rejected = files.length - supported.length;
    if (rejected > 0) {
      toast.warning(t('chat.input.attachmentUnsupported'));
    }
    if (supported.length > 0) addFiles(supported);
  }, [addFiles, t]);

  useEffect(() => {
    const prevKey = prevSessionKeyRef.current;
    if (prevKey) {
      topicComposerRef.current[prevKey] = { input, collapseOpen, showTypoBar };
    }
    const next = topicComposerRef.current[currentSessionKey];
    setInput(next?.input ?? '');
    setComposerReferences([]);
    setCollapseOpen(next?.collapseOpen ?? false);
    setShowTypoBar(next?.showTypoBar ?? false);
    setModelOpen(false);
    setSearchOpen(false);
    setToolsOpen(false);
    setParamsOpen(false);
    setHistoryOpen(false);
    setMemoryOpen(false);
    prevSessionKeyRef.current = currentSessionKey;
  }, [currentSessionKey]);

  useEffect(() => {
    if (!currentSessionKey) return;
    topicComposerRef.current[currentSessionKey] = { input, collapseOpen, showTypoBar };
  }, [currentSessionKey, input, collapseOpen, showTypoBar]);

  useEffect(() => { loadModels(); loadAgents(); loadApplets(); }, [loadModels, loadAgents, loadApplets]);

  const composerTrigger = useMemo(() => findComposerTrigger(input), [input]);

  const composerSuggestions = useMemo<ComposerSuggestion[]>(() => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === 'command') {
      const commandSuggestions: ComposerSuggestion[] = [
        {
          kind: 'command',
          id: 'search',
          token: '/search',
          label: t('chat.input.command.search'),
          description: t('chat.input.command.searchDesc'),
          icon: <Search size={14} />,
        },
        {
          kind: 'command',
          id: 'memory',
          token: '/memory',
          label: t('chat.input.command.memory'),
          description: t('chat.input.command.memoryDesc'),
          icon: <BrainCircuit size={14} />,
        },
        {
          kind: 'command',
          id: 'tool',
          token: '/tool',
          label: t('chat.input.command.tool'),
          description: t('chat.input.command.toolDesc'),
          icon: <Blocks size={14} />,
        },
      ];
      return commandSuggestions.filter((item) => item.token.slice(1).includes(composerTrigger.query)).slice(0, 5);
    }
    if (composerTrigger.kind === 'agent') {
      return agents
        .filter((agent) => {
          const q = composerTrigger.query;
          return !q || agent.name.toLowerCase().includes(q) || (agent.title || '').toLowerCase().includes(q);
        })
        .slice(0, 5)
        .map((agent) => ({
          kind: 'agent' as const,
          id: agent.name,
          token: `@${agent.name}`,
          label: agent.title || agent.name,
          description: agent.description || agent.name,
          icon: <Sparkles size={14} />,
        }));
    }
    return messages
      .filter((message) => message.content.trim())
      .slice(-8)
      .reverse()
      .filter((message) => {
        const q = composerTrigger.query;
        return !q || message.content.toLowerCase().includes(q);
      })
      .slice(0, 5)
      .map((message) => ({
        kind: 'message' as const,
        id: message.id,
        token: `#${message.id}`,
        label: t('chat.input.reference.message', { role: message.role }),
        description: formatMessageSnippet(message.content),
        icon: <FileText size={14} />,
      }));
  }, [agents, composerTrigger, messages, t]);

  const handleSelectComposerSuggestion = useCallback((suggestion: ComposerSuggestion) => {
    if (!composerTrigger) return;
    const nextInput = `${input.slice(0, composerTrigger.start)}${suggestion.token} ${input.slice(composerTrigger.end)}`;
    setInput(nextInput);
    setComposerReferences((prev) => {
      const withoutDuplicate = prev.filter((item) => !(item.kind === suggestion.kind && item.id === suggestion.id));
      return [...withoutDuplicate, {
        kind: suggestion.kind,
        id: suggestion.id,
        label: suggestion.label,
        token: suggestion.token,
      }];
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [composerTrigger, input]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if ((!text && readyAttachments.length === 0) || isStreaming || attachmentUploading || attachmentFailed) return;
    const attachments: ChatComposerAttachment[] = drafts
      .filter((item) => item.status === 'ready' && item.attachment)
      .map((item) => ({
        cid: item.attachment!.cid,
        filename: item.attachment!.filename || item.name,
        mime_type: item.attachment!.mime_type || item.mimeType,
        size: item.attachment!.size || item.size,
        previewUrl: item.previewUrl,
        attachment: item.attachment,
      }));
    const structuredContext = composerReferences.length > 0
      ? composerReferences.map((item) => `[${item.kind}:${item.id}] ${item.label}`).join('\n')
      : '';
    sendMessage(
      structuredContext ? `${structuredContext}\n\n${text || t('chat.input.attachmentMessageFallback')}` : text || t('chat.input.attachmentMessageFallback'),
      attachments,
    );
    setInput('');
    setComposerReferences([]);
    clearDrafts();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [attachmentFailed, attachmentUploading, clearDrafts, composerReferences, drafts, input, isStreaming, readyAttachments, sendMessage, t]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const native = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number };
    if (isComposingRef.current || native.isComposing || native.keyCode === 229) return;
    e.preventDefault();
    handleSend();
  }, [handleSend]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 320) + 'px'; }
  }, []);

  const handleFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    addSupportedFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [addSupportedFiles]);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (files.length === 0) return;
    e.preventDefault();
    addSupportedFiles(files);
  }, [addSupportedFiles]);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDraggingAttachment(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) addSupportedFiles(files);
  }, [addSupportedFiles]);

  const handleFormatInsert = useCallback((prefix: string, suffix: string, block?: boolean) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = input.substring(start, end);
    const replacement = (block && !selected) ? prefix : prefix + selected + suffix;
    const newValue = input.substring(0, start) + replacement + input.substring(end);
    setInput(newValue);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length + selected.length, start + prefix.length + selected.length);
    });
  }, [input]);

  const hasContent = input.trim() || readyAttachments.length > 0;
  const sendDisabled = !hasContent || attachmentUploading || attachmentFailed;
  const currentModelId = selectedModel || defaultModel;
  const modelInfo = availableModels.find((m) => m.id === currentModelId);
  const isWebSearchEnabled = enabledAppletIds.includes('web-search');

  return (
    <>
      {/* Agent Chat composer: centered rounded task input surface. */}
      <Flexbox style={{ padding: 0 }} gap={0}>
        <Flexbox
          onDragEnter={(e) => {
            e.preventDefault();
            setDraggingAttachment(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDraggingAttachment(false);
          }}
          onDrop={handleDrop}
          style={{
            background: token.colorBgContainer,
            border: `1px solid ${draggingAttachment ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
            borderRadius: 22,
            overflow: 'hidden',
            position: 'relative',
            boxShadow: '0 22px 70px rgba(15, 23, 42, 0.08)',
          }}
          gap={0}
        >
        {showTypoBar && <TypoBar onInsert={handleFormatInsert} />}

        <Flexbox style={{ padding: '12px 16px 12px' }} gap={0}>
          {draggingAttachment && (
            <Flexbox align="center" justify="center" style={{ position: 'absolute', inset: 0, zIndex: 4, background: token.colorBgMask, color: token.colorTextLightSolid, fontSize: 13, fontWeight: 600 }}>
              {t('chat.input.dropHint')}
            </Flexbox>
          )}

          {drafts.length > 0 && (
            <Flexbox horizontal gap={8} style={{ overflowX: 'auto', paddingBottom: 8 }}>
              {drafts.map((item) => (
                <ComposerAttachmentDraft
                  key={item.id}
                  item={item}
                  onRemove={() => removeDraft(item.id)}
                  onRetry={() => retryDraft(item.id)}
                />
              ))}
            </Flexbox>
          )}

          <ComposerSuggestionPanel
            suggestions={composerSuggestions}
            onSelect={handleSelectComposerSuggestion}
          />

          {composerReferences.length > 0 && (
            <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap', paddingBottom: 8 }}>
              {composerReferences.map((item) => (
                <Tag key={`${item.kind}:${item.id}`}>
                  {item.token}
                </Tag>
              ))}
            </Flexbox>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef} value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown} onInput={handleInput} onPaste={handlePaste}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            placeholder={customPlaceholder || t('chat.input.placeholder')}
            rows={compact ? 1 : 2}
            style={{
              width: '100%', resize: 'none', border: 'none', borderRadius: 0,
              padding: '8px 0', fontSize: 14, lineHeight: '1.6',
              outline: 'none', fontFamily: 'inherit', background: 'transparent',
              color: token.colorText, minHeight: compact ? 36 : 50, maxHeight: compact ? 160 : 320, overflow: 'auto',
            }}
          />

          {/* ActionBar — configurable via leftActions/rightActions props */}
          <Flexbox horizontal align="center" justify="space-between" style={{ paddingTop: 2 }}>
            <Flexbox horizontal align="center" gap={0}>
              {leftActions.map((actionKey, idx) => {
                switch (actionKey) {
                  case 'model':
                    return (
                      <div key="model" style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 24, background: token.colorFillTertiary }}>
                        <Popover open={modelOpen} onOpenChange={setModelOpen} placement="topLeft" trigger="click"
                          content={<ModelProviderSelect selectedModelId={selectedModel || defaultModel} onSelect={(id, pid) => useAgentStore.getState().setSelectedModel(id, pid)} onClose={() => setModelOpen(false)} onNavigateSettings={() => { setModelOpen(false); onNavigateSettings?.(); }} />}
                          styles={{ content: { padding: 0, minWidth: 280, maxWidth: 360 } }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 24, cursor: isStreaming ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = token.colorFillSecondary; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                          >
                            <ProviderIcon providerId={modelInfo?.provider_id || ''} providerName={modelInfo?.provider_name || currentModelId} size={22} />
                          </div>
                        </Popover>
                        <Popover open={paramsOpen} onOpenChange={setParamsOpen} placement="topLeft"
                          content={<ModelDetailPanel modelId={currentModelId} />}
                          styles={{ content: { padding: 0, minWidth: 360, maxWidth: 400 } }}
                        >
                          <div onClick={() => setParamsOpen(!paramsOpen)}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 36, borderRadius: 24, cursor: 'pointer', marginLeft: -4, transition: 'background 0.2s', color: token.colorTextSecondary }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = token.colorFillSecondary; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                          >
                            <Settings2 size={16} />
                          </div>
                        </Popover>
                      </div>
                    );
                  case 'search':
                    return (
                      <Popover key="search" open={searchOpen} onOpenChange={setSearchOpen} placement="topLeft" content={<SearchControls />} styles={{ content: { padding: 0 } }}>
                        <div>
                          <Action icon={isWebSearchEnabled ? <Globe size={20} /> : <GlobeOff size={20} />} title={t('chat.input.webSearch')} active={isWebSearchEnabled}
                            color={isWebSearchEnabled ? token.colorInfo : undefined} onClick={() => setSearchOpen(!searchOpen)} disabled={isStreaming} />
                        </div>
                      </Popover>
                    );
                  case 'memory':
                    return (
                      <Popover key="memory" open={memoryOpen} onOpenChange={setMemoryOpen} placement="topLeft" content={<MemoryControls />} styles={{ content: { padding: 0 } }}>
                        <div>
                          <Action icon={memoryEnabled ? <BrainCircuit size={20} /> : <Brain size={20} />} title={memoryEnabled ? t('chat.input.memoryOn') : t('chat.input.memoryOff')}
                            active={memoryEnabled} color={memoryEnabled ? token.colorInfo : undefined} onClick={() => setMemoryOpen(!memoryOpen)} disabled={isStreaming} />
                        </div>
                      </Popover>
                    );
                  case 'upload':
                    return (
                      <span key="upload">
                        <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.md,.json,.csv" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
                        <Action icon={<Paperclip size={20} />} title={t('chat.input.uploadFile')} onClick={() => fileInputRef.current?.click()} disabled={isStreaming} />
                      </span>
                    );
                  case 'voice':
                    return (
                      <Action key="voice" icon={isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                        title={isRecording ? t('chat.input.voiceRecording', { seconds: recordingTime }) : t('chat.input.voiceInput')}
                        onClick={handleVoiceInput} disabled={isStreaming} active={isRecording} color={isRecording ? token.colorError : undefined} />
                    );
                  case 'tools':
                    return (
                      <Popover key="tools" open={toolsOpen} onOpenChange={setToolsOpen} placement="topLeft"
                        content={<SkillAppletPopoverContent onClose={() => setToolsOpen(false)} onNavigateSkills={() => { setToolsOpen(false); setSkillsDialogOpen(true); }} onNavigateApplets={() => { setToolsOpen(false); onNavigateApplets?.(); }} />}
                        styles={{ content: { padding: 0, minWidth: 300, maxWidth: 340 } }}>
                        <div><Action icon={<Blocks size={20} />} title={t('chat.input.toolsAndSkills')} onClick={() => setToolsOpen(!toolsOpen)} disabled={isStreaming} /></div>
                      </Popover>
                    );
                  case 'divider':
                    return <Divider key={`div-${idx}`} type="vertical" style={{ margin: '0 4px', height: 20 }} />;
                  case 'more':
                    return collapseOpen ? (
                      <span key="more" style={{ display: 'contents' }}>
                        <Action icon={<TypeIcon size={20} />} title={showTypoBar ? t('chat.input.hideFormatting') : t('chat.input.showFormatting')} active={showTypoBar} onClick={() => setShowTypoBar(!showTypoBar)} />
                        <Popover open={historyOpen} onOpenChange={setHistoryOpen} placement="topLeft" content={<HistoryControls />} styles={{ content: { padding: 0 } }}>
                          <div>
                            <Action icon={historyEnabled ? <Timer size={20} /> : <TimerOff size={20} />}
                              title={historyEnabled ? t('chat.input.historyLimited', { count: chatConfig.historyCount ?? 20 }) : t('chat.input.historyUnlimited')}
                              onClick={() => setHistoryOpen(!historyOpen)} />
                          </div>
                        </Popover>
                        <Action icon={hasActiveTopic ? <MessageSquarePlus size={20} /> : <GalleryVerticalEnd size={20} />}
                          title={hasActiveTopic ? t('chat.input.newTopic') : t('chat.input.saveTopic')} onClick={() => saveCurrentTopic()} disabled={isStreaming || !hasActiveTopic} />
                        <Popconfirm title={t('chat.input.clearConfirm')} onConfirm={() => useChatStore.getState().sendMessage('/clear')} okText={t('chat.input.clearAction')} cancelText={t('chat.input.cancelAction')} placement="top">
                          <div><Action icon={<Eraser size={20} />} title={t('chat.input.clearMessages')} disabled={isStreaming} /></div>
                        </Popconfirm>
                        <Action icon={<ChevronDown size={16} />} title={t('chat.input.collapse')} onClick={() => setCollapseOpen(false)} style={{ width: 24 }} />
                      </span>
                    ) : (
                      <Action key="more" icon={<ChevronRight size={16} />} title={t('chat.input.moreActions')} onClick={() => setCollapseOpen(true)} style={{ width: 24 }} />
                    );
                  default:
                    return null;
                }
              })}
            </Flexbox>

            {/* Right side: configurable right actions + Send */}
            <Flexbox horizontal align="center" gap={8}>
              {rightActions.includes('token') && <TokenDisplay inputText={input} />}
              {isStreaming ? (
                <ActionIcon icon={Square} onClick={stopStreaming} title={t('chat.input.stop')} size={{ blockSize: 36, size: 20 }} style={{ background: token.colorError, color: '#fff', borderRadius: 12 }} />
              ) : (
                <ActionIcon icon={Send} onClick={handleSend} disabled={sendDisabled} title={t('chat.input.send')} size={{ blockSize: 36, size: 20 }}
                  style={{ background: !sendDisabled ? token.colorPrimary : token.colorFillSecondary, color: !sendDisabled ? '#fff' : token.colorTextQuaternary, borderRadius: 12 }}
                />
              )}
            </Flexbox>
          </Flexbox>
        </Flexbox>
        </Flexbox>
      </Flexbox>

      {/* Skills Dialog */}
      <SkillsDialog
        open={skillsDialogOpen}
        onClose={() => setSkillsDialogOpen(false)}
        onNavigateSkillSettings={() => onNavigateSkills?.()}
      />
    </>
  );
}
