// Agent Prototype — Agent Profile Editor (Center Panel)
// Quiet Protocol Minimalism surface for an ordinary Agent:
// - Hero: reference-aligned 64px identity axis + editable name/description
// - Avatar picker: emoji or validated local image
// - SOUL.md / AGENTS.md: two side-by-side monospace editors
// - Extensions: selected Agent bindings only; the Settings-owned catalog stays
//   behind explicit Add skill / Add MCP tool pickers
//
// Subtractions (ordinary-user product decision, see agent-chat-coverage F2/F4):
// - Configure/Activity mode switch and Tasks/Memories/Diagnostics tabs cut:
//   no real turn/memory/diagnostic data exists in the prototype, so the tabs
//   were corpse surfaces rendered from hardcoded arrays.
// - The old Capabilities and Workspace tabs cut: filesystem retention remains
//   Station-owned, while capability selection now has one real per-Agent
//   binding model instead of mock Skill/Tool/MCP rows.
// - AI Rewrite button removed: no rewrite action exists behind it.
//
// Persistence (reference Agent Profile Builder parity): the Agent already
// exists when this surface opens. Identity,
// description, SOUL/AGENTS and extensions persist to localStorage (one key per
// agent id) on a short debounce; the roster owner receives live identity
// changes through onIdentityChange. Save outcomes use the shared shell toast;
// there is no blocking Save gate or persistent status label.

import { type CSSProperties, type RefObject, useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, BookOpen, Image as ImageIcon, Plug, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { T } from '../theme';
import type { Agent } from '../types';
import {
  buildAgentExtensionCatalog,
  type PrototypeAgentExtension,
  type PrototypeExtensionKind,
} from '../../../../shared/agentExtensionCatalog';
import {
  INITIAL_AGENT_AVATAR,
  PrototypeAgentAvatarView,
  type PrototypeAgentAvatar,
} from '../../../../shared/PrototypeAgentAvatar';
import { toast } from '../../../../shared/Toast';

// -- Persisted draft --

interface ProfileDraft {
  id: string;
  title: string;
  description: string;
  soulMd: string;
  agentsMd: string;
  soulCustomized?: boolean;
}

function profileDraftKey(id: string): string {
  return `agent-profile-${id}`;
}

export function loadProfileDraft(id: string): ProfileDraft | null {
  try {
    const raw = localStorage.getItem(profileDraftKey(id));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const draft = parsed as Record<string, unknown>;
    if (draft.id !== id) return null;
    if (typeof draft.title !== 'string' || typeof draft.description !== 'string') return null;
    if (typeof draft.soulMd !== 'string' || typeof draft.agentsMd !== 'string') return null;
    return {
      id,
      // Normalize the built-in seed rename ("Assistant" -> "Agent"); a draft
      // the user renamed to anything else is returned untouched.
      title: id === 'assistant' && draft.title === 'Assistant' ? 'Agent' : draft.title,
      description: draft.description,
      soulMd: draft.soulMd,
      agentsMd: draft.agentsMd,
      soulCustomized: typeof draft.soulCustomized === 'boolean'
        ? draft.soulCustomized
        : draft.soulMd !== defaultSoulMd({ name: draft.title, description: draft.description }),
    };
  } catch {
    return null;
  }
}

function defaultSoulMd(agent: Pick<Agent, 'name' | 'description'>): string {
  return `# SOUL.md

## Identity
You are ${agent.name || 'the Agent'}.

${agent.description}

## Behavior
- Explain intent before acting
- Keep work focused and verifiable
- Ask before risky or irreversible actions
`;
}

function defaultAgentsMd(): string {
  return `# AGENTS.md

## Workflow
- Understand the user goal
- Use the capabilities bound to this agent
- Return evidence with the result

## Delegation Rules
- Delegate only when another agent has a clearer capability fit
`;
}

// -- Extensions (Skills + MCP/tool servers) --
// Settings owns the available catalog. Profile owns only the bindings selected
// for this Agent, so a large catalog never becomes a large Profile list.

interface ExtensionBindingState {
  bound: Set<string>;
  enabled: Set<string>;
}

function extensionStoreKey(agentId: string) { return `agent-profile-${agentId}-extensions`; }

function extensionCatalog(): PrototypeAgentExtension[] {
  if (typeof window === 'undefined') return buildAgentExtensionCatalog();
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('review') === '1'
    ? Number(params.get('agentCatalogSize') ?? 0)
    : 0;
  return buildAgentExtensionCatalog(requested);
}

function loadExtensionBindings(agentId: string): ExtensionBindingState {
  try {
    const raw = localStorage.getItem(extensionStoreKey(agentId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const known = new Set(extensionCatalog().map((extension) => extension.id));
    if (Array.isArray(parsed)) {
      const legacy = parsed.filter((value): value is string =>
        typeof value === 'string' && known.has(value));
      return { bound: new Set(legacy), enabled: new Set(legacy) };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return { bound: new Set(), enabled: new Set() };
    }
    const record = parsed as Record<string, unknown>;
    const bound = Array.isArray(record.bound)
      ? record.bound.filter((value): value is string =>
        typeof value === 'string' && known.has(value))
      : [];
    const boundSet = new Set(bound);
    const enabled = Array.isArray(record.enabled)
      ? record.enabled.filter((value): value is string =>
        typeof value === 'string' && boundSet.has(value))
      : [];
    return { bound: boundSet, enabled: new Set(enabled) };
  } catch {
    return { bound: new Set(), enabled: new Set() };
  }
}

export interface AgentSlashCommand {
  id: string;
  kind: PrototypeExtensionKind;
  name: string;
  token: string;
  description: string;
}

// Real per-agent slash commands: the extensions enabled on this Agent in its
// Profile (matches the reference commands & skills palette data source).
export function listAgentSlashCommands(agentId: string): AgentSlashCommand[] {
  const bindings = loadExtensionBindings(agentId);
  return extensionCatalog()
    .filter((extension) => bindings.bound.has(extension.id) && bindings.enabled.has(extension.id))
    .map((ext) => ({
      id: ext.id,
      kind: ext.kind,
      name: ext.name,
      token: ext.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      description: ext.description,
    }));
}

// -- Component --

interface AgentProfileProps {
  agent: Agent;
  onBack?: () => void;
  // Live identity sync for a multi-agent roster owner. Called (debounced) on
  // every change; an empty name keeps the roster's previous name.
  onIdentityChange?: (name: string, description: string) => void;
  // The roster owns entity lifetime. A deleted Agent must not regain a
  // profile draft through the editor's final navigation/unmount flush.
  canPersist?: () => boolean;
  initialSection?: 'identity' | 'extensions';
  avatar?: PrototypeAgentAvatar;
  onAvatarChange?: (avatar: PrototypeAgentAvatar) => void;
}

export function AgentProfile({
  agent,
  onBack,
  onIdentityChange,
  canPersist,
  initialSection = 'identity',
  avatar = INITIAL_AGENT_AVATAR,
  onAvatarChange,
}: AgentProfileProps) {

  const [draft] = useState<ProfileDraft | null>(() => loadProfileDraft(agent.id));
  const [title, setTitle] = useState(draft?.title ?? agent.name);
  const [description, setDescription] = useState(draft?.description ?? agent.description);
  const [soulMd, setSoulMd] = useState(draft?.soulMd ?? defaultSoulMd(agent));
  const [agentsMd, setAgentsMd] = useState(draft?.agentsMd ?? defaultAgentsMd());
  const [profileTab, setProfileTab] = useState<'identity' | 'extensions'>(initialSection);
  const [catalog] = useState<PrototypeAgentExtension[]>(extensionCatalog);
  const [extensionBindings, setExtensionBindings] = useState<ExtensionBindingState>(
    () => loadExtensionBindings(agent.id),
  );
  const extensionSavedRef = useRef(JSON.stringify({
    bound: [...extensionBindings.bound],
    enabled: [...extensionBindings.enabled],
  }));
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  // Automatic saves do not turn generated SOUL.md into a manual edit.
  // Its ownership survives reopening; custom text is never regenerated.
  const soulTouchedRef = useRef(draft?.soulCustomized ?? false);

  // Keep the latest identity callback in a ref so the autosave effect does not
  // re-fire on every parent render (the parent passes an inline closure).
  const identityChangeRef = useRef(onIdentityChange);
  identityChangeRef.current = onIdentityChange;
  const canPersistRef = useRef(canPersist);
  canPersistRef.current = canPersist;

  // Pristine SOUL.md stays in sync with the identity fields, the same way the
  // generated template would render after a rename. Once the user edits the
  // file directly, it becomes user-owned and this stops touching it.
  useEffect(() => {
    if (soulTouchedRef.current) return;
    setSoulMd(defaultSoulMd({ ...agent, name: title.trim() || 'the Agent', description }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, agent.id]);

  const latestDraftRef = useRef<ProfileDraft>({ id: agent.id, title, description, soulMd, agentsMd });
  latestDraftRef.current = {
    id: agent.id, title: title.trim(), description: description.trim(),
    soulMd, agentsMd, soulCustomized: soulTouchedRef.current,
  };
  const savedDraftRef = useRef(JSON.stringify(latestDraftRef.current));

  // One save owner for debounce, navigation, and page teardown. The latest
  // committed edit is flushed before leaving; storage failure never prevents
  // the live roster from receiving the user's identity change.
  const persistDraft = useCallback((): 'unchanged' | 'saved' | 'failed' => {
    if (canPersistRef.current?.() === false) return 'unchanged';
    const payload = latestDraftRef.current;
    const serialized = JSON.stringify(payload);
    if (serialized === savedDraftRef.current) return 'unchanged';
    identityChangeRef.current?.(payload.title, payload.description);
    try {
      localStorage.setItem(profileDraftKey(payload.id), serialized);
      savedDraftRef.current = serialized;
      return 'saved';
    } catch {
      return 'failed';
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const result = persistDraft();
      if (result === 'saved') toast.success('Changes saved');
      if (result === 'failed') toast.error('Could not save changes');
    }, 300);
    return () => window.clearTimeout(handle);
  }, [title, description, soulMd, agentsMd, persistDraft]);

  useLayoutEffect(() => {
    const flush = () => { persistDraft(); };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [persistDraft]);

  const backToChat = () => {
    const result = persistDraft();
    if (result === 'saved') toast.success('Changes saved');
    if (result === 'failed') toast.error('Could not save changes');
    onBack?.();
  };

  const updateExtensionBindings = useCallback((
    update: (previous: ExtensionBindingState) => ExtensionBindingState,
  ) => {
    setExtensionBindings(update);
  }, []);

  useEffect(() => {
    const serialized = JSON.stringify({
      bound: [...extensionBindings.bound],
      enabled: [...extensionBindings.enabled],
    });
    if (serialized === extensionSavedRef.current) return;
    try {
      localStorage.setItem(extensionStoreKey(agent.id), serialized);
      extensionSavedRef.current = serialized;
      toast.success('Changes saved');
    } catch {
      toast.error('Could not save changes');
    }
  }, [agent.id, extensionBindings]);

  const bindExtension = useCallback((id: string) => {
    updateExtensionBindings((previous) => ({
      bound: new Set(previous.bound).add(id),
      enabled: new Set(previous.enabled).add(id),
    }));
  }, [updateExtensionBindings]);

  const toggleExtension = useCallback((id: string) => {
    updateExtensionBindings((previous) => {
      if (!previous.bound.has(id)) return previous;
      const enabled = new Set(previous.enabled);
      if (enabled.has(id)) enabled.delete(id); else enabled.add(id);
      return { bound: new Set(previous.bound), enabled };
    });
  }, [updateExtensionBindings]);

  const removeExtension = useCallback((id: string) => {
    updateExtensionBindings((previous) => {
      const bound = new Set(previous.bound);
      const enabled = new Set(previous.enabled);
      bound.delete(id);
      enabled.delete(id);
      return { bound, enabled };
    });
  }, [updateExtensionBindings]);

  return (
    <div style={S.shell}>
      <style>{`
        .pt-profile-card:focus-within { border-color: ${T.border.focus} !important; }
        .pt-extension-picker button:hover { background: ${T.surface.subtle} !important; }
        .pt-extension-picker button:focus-visible {
          outline: 2px solid ${T.border.focus};
          outline-offset: 1px;
        }
        .pt-profile-avatar:focus-visible {
          outline: 2px solid ${T.border.focus};
          outline-offset: 2px;
        }
        @container (max-width: 680px) {
          .pt-profile-scroll { padding: 0 16px 16px !important; }
          .pt-profile-editors { grid-template-columns: minmax(0, 1fr) !important; flex: none !important; }
          .pt-profile-editors > div { min-height: 280px !important; }
        }
      `}</style>
      <div className="pt-profile-scroll" style={S.scrollContainer}>
        <div style={S.centeredContent}>
          {/* ---- Hero Section ---- */}
          <div style={S.hero}>
            <div style={S.identityRow}>
              <div style={S.identityAxis}>
                <button type="button" style={S.iconBtn} title="Back to chat" aria-label="Back to chat" onClick={backToChat}>
                  <ArrowLeft size={16} color={T.text.secondary} />
                </button>
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Agent title..."
                style={S.titleInput}
                aria-label="Agent title"
              />
            </div>

            <div style={{ ...S.identityRow, alignItems: 'start' }}>
              <div style={{ ...S.identityAxis, position: 'relative' }}>
                <button
                  ref={avatarButtonRef}
                  type="button"
                  className="pt-profile-avatar"
                  style={S.avatarButton}
                  aria-label="Change Agent avatar"
                  aria-haspopup="dialog"
                  aria-expanded={avatarPickerOpen}
                  onClick={() => setAvatarPickerOpen((open) => !open)}
                >
                  <PrototypeAgentAvatarView avatar={avatar} name={title} size={64} radius={12} />
                </button>
                {avatarPickerOpen ? (
                  <AvatarPicker
                    anchor={avatarButtonRef}
                    avatar={avatar}
                    onChange={(next) => {
                      onAvatarChange?.(next);
                      toast.success('Changes saved');
                      setAvatarPickerOpen(false);
                      requestAnimationFrame(() => avatarButtonRef.current?.focus());
                    }}
                    onClose={() => {
                      setAvatarPickerOpen(false);
                      requestAnimationFrame(() => avatarButtonRef.current?.focus());
                    }}
                  />
                ) : null}
              </div>
              <div style={S.descriptionWrap}>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Describe what this agent does..."
                  style={S.descriptionTextarea}
                  aria-label="Agent description"
                />
              </div>
            </div>
          </div>

          {/* ---- Section tabs: Identity / Extensions ---- */}
          <div
            style={S.profileTabs}
            role="tablist"
            aria-label="Agent profile sections"
            onKeyDown={(event) => {
              const tabs = ['identity', 'extensions'] as const;
              const current = tabs.indexOf(profileTab);
              let next: number;
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = 1 - current;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = 1;
              else return;
              event.preventDefault();
              setProfileTab(tabs[next]);
              event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={profileTab === 'identity'}
              tabIndex={profileTab === 'identity' ? 0 : -1}
              style={S.profileTab(profileTab === 'identity')}
              onClick={() => setProfileTab('identity')}
            >
              Identity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={profileTab === 'extensions'}
              tabIndex={profileTab === 'extensions' ? 0 : -1}
              style={S.profileTab(profileTab === 'extensions')}
              onClick={() => setProfileTab('extensions')}
            >
              Extensions
              <span style={S.tabCount}>{extensionBindings.bound.size}</span>
            </button>
          </div>

          {profileTab === 'extensions' ? (
            <ExtensionsPanel
              catalog={catalog}
              bindings={extensionBindings}
              onBind={bindExtension}
              onToggle={toggleExtension}
              onRemove={removeExtension}
            />
          ) : (
            <div className="pt-profile-editors" style={S.soulGrid}>
              <ProfileCard title="SOUL.md">
                <div style={S.textareaWrap}>
                  <textarea
                    value={soulMd}
                    onChange={(e) => { soulTouchedRef.current = true; setSoulMd(e.target.value); }}
                    placeholder="Define the agent's identity, behavior, and guidelines..."
                    style={S.codeTextarea}
                    aria-label="SOUL.md"
                  />
                </div>
              </ProfileCard>
              <ProfileCard title="AGENTS.md">
                <div style={S.textareaWrap}>
                  <textarea
                    value={agentsMd}
                    onChange={(e) => setAgentsMd(e.target.value)}
                    placeholder="Define the agent's workflow and delegation rules..."
                    style={S.codeTextarea}
                    aria-label="AGENTS.md"
                  />
                </div>
              </ProfileCard>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const AVATAR_EMOJIS = [
  ['😀', 'happy smile'], ['🙂', 'friendly smile'], ['😎', 'cool'], ['🤓', 'nerd expert'],
  ['🧐', 'research'], ['🤖', 'robot agent'], ['👋', 'welcome'], ['✨', 'sparkles'],
  ['💡', 'idea'], ['🎯', 'goal target'], ['🚀', 'launch'], ['🧭', 'guide compass'],
  ['🛠️', 'tools build'], ['🧠', 'brain thinking'], ['📚', 'books knowledge'], ['✍️', 'write'],
  ['🔍', 'search'], ['📊', 'chart analytics'], ['💬', 'chat'], ['✅', 'done check'],
  ['🌱', 'growth'], ['🌐', 'web globe'], ['🔒', 'security lock'], ['⚡', 'fast lightning'],
  ['🎨', 'design art'], ['🧪', 'experiment lab'], ['📎', 'attachment'], ['🗂️', 'organize files'],
  ['📅', 'calendar'], ['📝', 'notes'], ['🧩', 'integration puzzle'], ['🔧', 'settings wrench'],
  ['🏗️', 'architecture'], ['📣', 'announcement'], ['💻', 'code computer'], ['🛡️', 'shield safety'],
  ['🪄', 'magic automate'], ['📌', 'pin'], ['🔭', 'explore telescope'], ['🏁', 'finish flag'],
] as const;

function AvatarPicker({
  anchor,
  avatar,
  onChange,
  onClose,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  avatar: PrototypeAgentAvatar;
  onChange: (avatar: PrototypeAgentAvatar) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'emoji' | 'upload'>('emoji');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState(avatar.kind === 'image' ? avatar.value : '');
  const [error, setError] = useState('');
  const [position, setPosition] = useState({ top: 80, left: 16 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = AVATAR_EMOJIS.filter(([glyph, label]) =>
    !normalizedQuery || glyph.includes(normalizedQuery) || label.includes(normalizedQuery));

  useLayoutEffect(() => {
    const place = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(324, window.innerWidth - 16);
      const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
      const desiredTop = box.bottom + 8;
      const top = desiredTop + 430 <= window.innerHeight
        ? desiredTop
        : Math.max(8, box.top - 430);
      setPosition({ top, left });
    };
    place();
    dialogRef.current?.querySelector<HTMLElement>('[role="tab"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [anchor, onClose]);

  const chooseFile = (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Choose a PNG, JPEG, WebP, or GIF image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be 2 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPreview(reader.result);
    };
    reader.onerror = () => setError('This image could not be read.');
    reader.readAsDataURL(file);
  };

  return createPortal(
    <>
      <button type="button" aria-hidden tabIndex={-1} style={S.avatarPickerScrim} onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Change Agent avatar"
        style={{ ...S.avatarPicker, ...position }}
      >
        <div role="tablist" aria-label="Avatar source" style={S.avatarTabs}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'emoji'}
            style={S.avatarTab(tab === 'emoji')}
            onClick={() => setTab('emoji')}
          >
            Emoji
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'upload'}
            style={S.avatarTab(tab === 'upload')}
            onClick={() => setTab('upload')}
          >
            Upload
          </button>
          <button type="button" style={S.avatarPickerClose} aria-label="Close avatar picker" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {tab === 'emoji' ? (
          <>
            <label style={S.avatarSearch}>
              <Search size={14} color={T.text.muted} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search emoji"
                aria-label="Search emoji"
                style={S.avatarSearchInput}
              />
            </label>
            <div style={S.emojiGrid}>
              {filtered.map(([emoji]) => (
                <button
                  key={emoji}
                  type="button"
                  style={S.emojiButton(avatar.kind === 'emoji' && avatar.value === emoji)}
                  aria-label={`Use ${emoji} avatar`}
                  onClick={() => onChange({ kind: 'emoji', value: emoji })}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div style={S.avatarUploadBody}>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            <button type="button" style={S.avatarPreview} onClick={() => fileRef.current?.click()}>
              {preview
                ? <img src={preview} alt="Avatar preview" style={S.avatarPreviewImage} />
                : <><ImageIcon size={28} /><span>Choose image</span></>}
            </button>
            <button type="button" style={S.avatarChoose} onClick={() => fileRef.current?.click()}>
              <Upload size={14} />
              Choose file
            </button>
            <span style={S.avatarUploadHint}>PNG, JPEG, WebP, or GIF · 2 MB max</span>
            {error ? <span role="alert" style={S.avatarError}>{error}</span> : null}
          </div>
        )}

        <div style={S.avatarPickerFooter}>
          <button type="button" style={S.avatarSecondary} onClick={() => onChange(INITIAL_AGENT_AVATAR)}>
            Use initial
          </button>
          {tab === 'upload' ? (
            <>
              <button type="button" style={S.avatarSecondary} onClick={onClose}>Cancel</button>
              <button
                type="button"
                style={S.avatarPrimary}
                disabled={!preview}
                onClick={() => preview && onChange({ kind: 'image', value: preview })}
              >
                Save
              </button>
            </>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}

// Profile shows only capabilities bound to this Agent. The Settings-owned
// catalog is opened on explicit Add intent, searched, and rendered in bounded
// pages so a 100-item catalog does not become a 100-row Profile.
function ExtensionsPanel({ catalog, bindings, onBind, onToggle, onRemove }: {
  catalog: PrototypeAgentExtension[];
  bindings: ExtensionBindingState;
  onBind: (id: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [pickerKind, setPickerKind] = useState<PrototypeExtensionKind | null>(null);
  const skillAddRef = useRef<HTMLButtonElement>(null);
  const mcpAddRef = useRef<HTMLButtonElement>(null);
  const groups: Array<{
    kind: PrototypeExtensionKind;
    label: string;
    addLabel: string;
    empty: string;
    icon: typeof BookOpen;
  }> = [
    {
      kind: 'skill',
      label: 'Skills',
      addLabel: 'Add skill',
      empty: 'No skills added.',
      icon: BookOpen,
    },
    {
      kind: 'mcp',
      label: 'MCP tools',
      addLabel: 'Add MCP tool',
      empty: 'No MCP tools added.',
      icon: Plug,
    },
  ];

  const closePicker = () => {
    const returnTarget = pickerKind === 'skill' ? skillAddRef.current : mcpAddRef.current;
    setPickerKind(null);
    requestAnimationFrame(() => returnTarget?.focus());
  };

  return (
    <div style={S.extPanel}>
      {groups.map((g) => {
        const items = catalog.filter((extension) =>
          extension.kind === g.kind && bindings.bound.has(extension.id));
        const Icon = g.icon;
        return (
          <section key={g.kind} style={S.extGroup} aria-label={g.label}>
            <div style={S.extGroupHead}>
              <Icon size={14} color={T.text.secondary} />
              <strong style={S.extGroupTitle}>{g.label}</strong>
              <span style={S.extCount}>{items.length}</span>
              <button
                ref={g.kind === 'skill' ? skillAddRef : mcpAddRef}
                type="button"
                style={S.extAdd}
                aria-label={g.addLabel}
                title={g.addLabel}
                onClick={() => setPickerKind(g.kind)}
              >
                <Plus size={15} />
              </button>
            </div>
            {items.length === 0 ? (
              <div style={S.extEmpty}>{g.empty}</div>
            ) : (
              <div style={S.extList}>
                {items.map((extension) => {
                const enabled = bindings.enabled.has(extension.id);
                return (
                  <div key={extension.id} style={S.extRow(enabled)}>
                    <div style={{ minWidth: 0 }}>
                      <div style={S.extName}>{extension.name}</div>
                      <div style={S.extDesc}>{extension.description}</div>
                    </div>
                    <div style={S.extActions}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={`${enabled ? 'Disable' : 'Enable'} ${extension.name}`}
                        style={S.extSwitch(enabled)}
                        onClick={() => onToggle(extension.id)}
                      >
                        <span style={S.extSwitchKnob(enabled)} />
                      </button>
                      <button
                        type="button"
                        style={S.extRemove}
                        aria-label={`Remove ${extension.name}`}
                        title={`Remove ${extension.name}`}
                        onClick={() => onRemove(extension.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
              </div>
            )}
          </section>
        );
      })}
      {pickerKind && (
        <ExtensionPicker
          kind={pickerKind}
          catalog={catalog.filter((extension) =>
            extension.kind === pickerKind && !bindings.bound.has(extension.id))}
          onBind={onBind}
          onClose={closePicker}
        />
      )}
    </div>
  );
}

function ExtensionPicker({ kind, catalog, onBind, onClose }: {
  kind: PrototypeExtensionKind;
  catalog: PrototypeAgentExtension[];
  onBind: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(12);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const normalized = query.trim().toLowerCase();
  const filtered = catalog.filter((extension) =>
    !normalized ||
    extension.name.toLowerCase().includes(normalized) ||
    extension.description.toLowerCase().includes(normalized));
  const visible = filtered.slice(0, limit);
  const noun = kind === 'skill' ? 'skill' : 'MCP tool';

  useLayoutEffect(() => {
    searchRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) =>
        !element.hasAttribute('disabled') && element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const bind = (id: string) => {
    onBind(id);
    onClose();
  };

  return createPortal(
    <div style={S.extPickerScrim} onClick={onClose}>
      <div
        ref={dialogRef}
        className="pt-extension-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pt-extension-picker-title"
        style={S.extPicker}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={S.extPickerHead}>
          <div>
            <strong id="pt-extension-picker-title" style={S.extPickerTitle}>
              Add {noun}
            </strong>
            <div style={S.extPickerMeta}>{catalog.length} available</div>
          </div>
          <button type="button" style={S.extPickerClose} aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div style={S.extPickerSearch}>
          <Search size={14} color={T.text.muted} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(12);
            }}
            aria-label={`Search ${kind === 'skill' ? 'skills' : 'MCP tools'}`}
            placeholder={`Search ${kind === 'skill' ? 'skills' : 'MCP tools'}`}
            style={S.extPickerSearchInput}
          />
        </div>
        <div style={S.extPickerList}>
          {visible.map((extension) => (
            <button
              key={extension.id}
              type="button"
              style={S.extPickerRow}
              aria-label={`Add ${extension.name}`}
              onClick={() => bind(extension.id)}
            >
              <span style={S.extPickerRowIcon}>
                {kind === 'skill' ? <BookOpen size={14} /> : <Plug size={14} />}
              </span>
              <span style={S.extPickerRowText}>
                <strong style={S.extName}>{extension.name}</strong>
                <span style={S.extDesc}>{extension.description}</span>
              </span>
              <Plus size={14} color={T.action.primary} />
            </button>
          ))}
          {visible.length === 0 && (
            <div style={S.extPickerEmpty}>No matching {kind === 'skill' ? 'skills' : 'MCP tools'}.</div>
          )}
        </div>
        {visible.length < filtered.length && (
          <button
            type="button"
            style={S.extLoadMore}
            onClick={() => setLimit((current) => current + 12)}
          >
            Show 12 more
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

// -- ProfileCard --

function ProfileCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-profile-card" style={S.card}>
      <div style={S.cardHeader}>
        <span style={S.cardTitle}>{title}</span>
      </div>
      {children}
    </div>
  );
}

// -- Styles --

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  shell: {
    flex: 1,
    minWidth: 0,
    containerType: 'inline-size',
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  scrollContainer: {
    flex: 1,
    minHeight: 0,
    padding: '0 32px 20px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  centeredContent: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    maxWidth: 980,
    margin: '0 auto',
    width: '100%',
  },

  // Hero
  hero: {
    paddingTop: 14,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  identityRow: {
    display: 'grid',
    gridTemplateColumns: '64px minmax(0, 1fr)',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  identityAxis: {
    width: 64,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexShrink: 0,
  },
  titleInput: {
    height: 38,
    boxSizing: 'border-box' as const,
    flex: 1,
    minWidth: 0,
    border: 0,
    outline: 'none',
    background: 'transparent',
    color: T.text.primary,
    fontSize: 23,
    fontWeight: 750,
    lineHeight: 1.2,
    letterSpacing: 0,
    padding: '0 8px',
  },
  iconBtn: {
    width: 36,
    height: 36,
    border: '1px solid transparent',
    borderRadius: 8,
    background: 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  avatarButton: {
    width: 64,
    height: 64,
    padding: 0,
    borderRadius: 12,
    border: 0,
    background: 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  descriptionWrap: {
    flex: 1,
    minWidth: 0,
  },
  descriptionTextarea: {
    width: '100%',
    height: 64,
    minHeight: 64,
    maxHeight: 96,
    resize: 'vertical' as const,
    border: `1px solid ${T.border.hairline}`,
    borderRadius: 8,
    outline: 'none',
    background: T.surface.canvas,
    color: T.text.secondary,
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: 1.45,
    padding: '9px 10px',
    boxSizing: 'border-box' as const,
  },
  avatarPickerScrim: {
    position: 'fixed',
    inset: 0,
    zIndex: 89,
    border: 0,
    padding: 0,
    background: 'transparent',
  },
  avatarPicker: {
    position: 'fixed',
    zIndex: 90,
    width: 324,
    maxWidth: 'calc(100vw - 16px)',
    minHeight: 318,
    maxHeight: 'calc(100vh - 16px)',
    overflowY: 'auto',
    padding: 12,
    boxSizing: 'border-box',
    border: `1px solid ${T.border.hairline}`,
    borderRadius: 10,
    background: T.surface.canvas,
    boxShadow: '0 18px 48px rgba(15, 23, 42, 0.20)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  avatarTabs: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    borderBottom: `1px solid ${T.border.hairline}`,
  },
  avatarTab: (active: boolean): CSSProperties => ({
    height: 34,
    padding: '0 10px',
    marginBottom: -1,
    border: 0,
    borderBottom: `2px solid ${active ? T.action.primary : 'transparent'}`,
    background: 'transparent',
    color: active ? T.text.primary : T.text.muted,
    fontSize: 12.5,
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
  }),
  avatarPickerClose: {
    width: 30,
    height: 30,
    marginLeft: 'auto',
    border: 0,
    borderRadius: 8,
    background: 'transparent',
    color: T.text.secondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  avatarSearch: {
    height: 34,
    padding: '0 10px',
    border: `1px solid ${T.border.hairline}`,
    borderRadius: 8,
    background: T.surface.base,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  avatarSearchInput: {
    flex: 1,
    minWidth: 0,
    border: 0,
    outline: 'none',
    background: 'transparent',
    color: T.text.primary,
    fontFamily: 'inherit',
    fontSize: 13,
  },
  emojiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
    gap: 4,
  },
  emojiButton: (active: boolean): CSSProperties => ({
    aspectRatio: '1',
    minWidth: 0,
    border: `1px solid ${active ? T.action.primary : 'transparent'}`,
    borderRadius: 7,
    background: active ? 'rgba(107,91,214,0.08)' : 'transparent',
    fontSize: 21,
    cursor: 'pointer',
  }),
  avatarUploadBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 9,
    padding: '6px 0',
  },
  avatarPreview: {
    width: 112,
    height: 112,
    padding: 0,
    overflow: 'hidden',
    border: `1px dashed ${T.border.hairline}`,
    borderRadius: 12,
    background: T.surface.base,
    color: T.text.muted,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontSize: 12,
    cursor: 'pointer',
  },
  avatarPreviewImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  avatarChoose: {
    height: 30,
    padding: '0 11px',
    border: `1px solid ${T.border.hairline}`,
    borderRadius: 8,
    background: T.surface.canvas,
    color: T.text.secondary,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
  },
  avatarUploadHint: { color: T.text.muted, fontSize: 11.5 },
  avatarError: { color: '#cf1322', fontSize: 11.5, textAlign: 'center' },
  avatarPickerFooter: {
    minHeight: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
  },
  avatarSecondary: {
    height: 30,
    padding: '0 10px',
    border: `1px solid ${T.border.hairline}`,
    borderRadius: 8,
    background: T.surface.canvas,
    color: T.text.secondary,
    fontSize: 12.5,
    cursor: 'pointer',
  },
  avatarPrimary: {
    height: 30,
    padding: '0 13px',
    border: 0,
    borderRadius: 8,
    background: T.action.primary,
    color: '#fff',
    fontSize: 12.5,
    fontWeight: 650,
    cursor: 'pointer',
  },
  // Identity editors
  soulGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: T.space.md,
    flex: 1,
    minHeight: 0,
    alignItems: 'stretch',
  },
  codeTextarea: {
    width: '100%',
    height: '100%',
    minHeight: 160,
    padding: 0,
    borderRadius: 0,
    border: 0,
    background: 'transparent',
    fontFamily: "'JetBrains Mono', 'Fira Code', SF Mono, Menlo, Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.7,
    resize: 'none' as const,
    outline: 'none',
    color: T.text.primary,
    boxSizing: 'border-box' as const,
    overflow: 'auto',
    display: 'block',
  },
  textareaWrap: {
    flex: 1,
    minHeight: 160,
    display: 'flex',
    flexDirection: 'column',
  },

  // ProfileCard
  card: {
    padding: T.space.md,
    borderRadius: T.radius.lg,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
    display: 'flex',
    flexDirection: 'column',
    gap: T.space.md,
    minHeight: 0,
  },
  cardHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: T.text.primary,
  },

  // Profile section tabs
  profileTabs: {
    display: 'flex',
    gap: 4,
    flexShrink: 0,
    margin: '4px 0 12px',
    borderBottom: `1px solid ${T.border.hairline}`,
  },
  profileTab: (active: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: 0,
    borderBottom: `2px solid ${active ? T.action.primary : 'transparent'}`,
    marginBottom: -1,
    background: 'transparent',
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    color: active ? T.text.primary : T.text.muted,
    cursor: 'pointer',
  }),
  tabCount: {
    minWidth: 18,
    height: 18,
    padding: '0 5px',
    borderRadius: 999,
    background: T.surface.subtle,
    color: T.text.secondary,
    fontSize: 11,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Extensions panel
  extPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  extGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  extGroupHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
  },
  extGroupTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: T.text.primary,
  },
  extCount: {
    minWidth: 18,
    height: 18,
    padding: '0 5px',
    borderRadius: 999,
    background: T.surface.subtle,
    color: T.text.secondary,
    fontSize: 11,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  extAdd: {
    marginLeft: 'auto',
    width: 30,
    height: 30,
    padding: 0,
    borderRadius: 8,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
    color: T.text.secondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  extEmpty: {
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    padding: '0 2px',
    color: T.text.muted,
    fontSize: 12.5,
  },
  extList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  extRow: (on: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '11px 13px',
    borderRadius: 10,
    border: `1px solid ${on ? T.action.primary : T.border.hairline}`,
    background: on ? 'rgba(107,91,214,0.05)' : T.surface.canvas,
  }),
  extName: {
    fontSize: 13,
    fontWeight: 600,
    color: T.text.primary,
  },
  extDesc: {
    fontSize: 12,
    color: T.text.secondary,
    marginTop: 2,
    lineHeight: 1.45,
  },
  extActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  extSwitch: (on: boolean): CSSProperties => ({
    flexShrink: 0,
    width: 36,
    height: 21,
    borderRadius: 999,
    border: 0,
    padding: 2,
    background: on ? T.action.primary : T.surface.subtle,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    transition: 'background .12s',
  }),
  extSwitchKnob: (on: boolean): CSSProperties => ({
    width: 17,
    height: 17,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 2px rgba(15,23,42,0.18)',
    transform: on ? 'translateX(15px)' : 'translateX(0)',
    transition: 'transform .12s',
  }),
  extRemove: {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: 0,
    background: 'transparent',
    color: T.text.muted,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  extPickerScrim: {
    position: 'fixed',
    inset: 0,
    zIndex: 80,
    background: 'rgba(15, 23, 42, 0.28)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  extPicker: {
    width: 460,
    maxWidth: '100%',
    maxHeight: 'min(620px, calc(100vh - 48px))',
    padding: 14,
    borderRadius: 12,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
    boxShadow: '0 18px 48px rgba(15, 23, 42, 0.18)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  extPickerHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  extPickerTitle: {
    display: 'block',
    color: T.text.primary,
    fontSize: 15,
  },
  extPickerMeta: {
    marginTop: 2,
    color: T.text.muted,
    fontSize: 11.5,
  },
  extPickerClose: {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: 0,
    background: 'transparent',
    color: T.text.secondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  extPickerSearch: {
    height: 34,
    padding: '0 10px',
    borderRadius: 8,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.base,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  extPickerSearchInput: {
    flex: 1,
    minWidth: 0,
    border: 0,
    outline: 'none',
    background: 'transparent',
    color: T.text.primary,
    fontFamily: 'inherit',
    fontSize: 13,
  },
  extPickerList: {
    minHeight: 72,
    maxHeight: 360,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  extPickerRow: {
    width: '100%',
    minHeight: 52,
    padding: '7px 9px',
    borderRadius: 8,
    border: 0,
    background: 'transparent',
    color: T.text.primary,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    textAlign: 'left',
    cursor: 'pointer',
  },
  extPickerRowIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    background: T.surface.subtle,
    color: T.text.secondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  extPickerRowText: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  extPickerEmpty: {
    minHeight: 72,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: T.text.muted,
    fontSize: 12.5,
  },
  extLoadMore: {
    alignSelf: 'center',
    height: 30,
    padding: '0 12px',
    borderRadius: 8,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
    color: T.text.secondary,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
