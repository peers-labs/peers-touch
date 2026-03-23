import { useState, useEffect, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Popover } from '@lobehub/ui';
import { theme, Checkbox, Divider, Tag } from 'antd';
import {
  Plus,
  BookOpen,
  Settings2,
  ChevronRight,
} from 'lucide-react';
import { api, type BuiltinSkillInfo, type SkillListItem } from '../services/api';
import { useChatStore } from '../store/chat';

function SelectorRow({
  icon,
  label,
  description,
  trailing,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
}) {
  const { token } = theme.useToken();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        padding: '6px 12px',
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
      <div
        style={{
          width: 24,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <span style={{ fontSize: 13 }}>{label}</span>
        {description && (
          <span
            style={{
              fontSize: 11,
              color: token.colorTextDescription,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {description}
          </span>
        )}
      </Flexbox>
      {trailing}
    </div>
  );
}

function useSkillAppletState() {
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [builtins, setBuiltins] = useState<BuiltinSkillInfo[]>([]);
  const { applets, enabledAppletIds, toggleApplet } = useChatStore();

  useEffect(() => {
    api
      .listSkills()
      .then((data) => {
        setSkills(data.skills);
        setBuiltins(data.builtin);
      })
      .catch(() => {});
  }, []);

  const toggleSkill = useCallback(async (id: string, enabled: boolean) => {
    try {
      await api.toggleSkill(id, enabled);
      setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
    } catch {
      // silent
    }
  }, []);

  return { skills, builtins, applets, enabledAppletIds, toggleApplet, toggleSkill };
}

interface PopoverBodyProps {
  skills: SkillListItem[];
  builtins: BuiltinSkillInfo[];
  applets: any[];
  enabledAppletIds: string[];
  onToggleSkill: (id: string, enabled: boolean) => void;
  onToggleApplet: (id: string) => void;
  onClose: () => void;
  onNavigateSkillHub?: () => void;
  onNavigateSkillManagement?: () => void;
  onNavigateAppletManagement?: () => void;
}

function PopoverBody({
  skills,
  builtins,
  applets,
  enabledAppletIds,
  onToggleSkill,
  onToggleApplet,
  onClose,
  onNavigateSkillHub,
  onNavigateSkillManagement,
  onNavigateAppletManagement,
}: PopoverBodyProps) {
  const { token } = theme.useToken();

  return (
    <Flexbox gap={0}>
      <div style={{ maxHeight: 400, overflowY: 'auto', padding: 4 }}>
        {/* Skills */}
        <div
          style={{
            padding: '8px 12px 4px',
            fontSize: 12,
            color: token.colorTextSecondary,
            fontWeight: 500,
          }}
        >
          Skills
        </div>
        {builtins.map((s) => (
          <SelectorRow
            key={s.identifier}
            icon={<span style={{ fontSize: 16 }}>{s.avatar || '📋'}</span>}
            label={s.name}
            description={s.description}
          />
        ))}
        {skills.map((s) => (
          <SelectorRow
            key={s.id}
            icon={<span style={{ fontSize: 16 }}>{s.metaAvatar || '🔧'}</span>}
            label={s.metaTitle || s.name}
            description={s.description}
            trailing={<Checkbox checked={s.enabled} />}
            onClick={() => onToggleSkill(s.id, !s.enabled)}
          />
        ))}
        {builtins.length === 0 && skills.length === 0 && (
          <div
            style={{
              padding: '8px 16px',
              color: token.colorTextDescription,
              fontSize: 13,
            }}
          >
            No skills available
          </div>
        )}
        <SelectorRow
          icon={<BookOpen size={18} />}
          label="Skill Hub"
          trailing={<ChevronRight size={16} style={{ opacity: 0.5 }} />}
          onClick={() => {
            onClose();
            onNavigateSkillHub?.();
          }}
        />
        <SelectorRow
          icon={<Settings2 size={18} />}
          label="Skill Management"
          trailing={<ChevronRight size={16} style={{ opacity: 0.5 }} />}
          onClick={() => {
            onClose();
            onNavigateSkillManagement?.();
          }}
        />

        <Divider style={{ margin: '4px 8px' }} />

        {/* Applets */}
        <div
          style={{
            padding: '8px 12px 4px',
            fontSize: 12,
            color: token.colorTextSecondary,
            fontWeight: 500,
          }}
        >
          Applets
        </div>
        {applets.length === 0 ? (
          <div
            style={{
              padding: '8px 16px',
              color: token.colorTextDescription,
              fontSize: 13,
            }}
          >
            No applets installed
          </div>
        ) : (
          applets.map((a) => (
            <SelectorRow
              key={a.manifest.id}
              icon={
                <span style={{ fontSize: 16 }}>
                  {a.manifest.icon === 'Globe' ? '🌐' : '🧩'}
                </span>
              }
              label={a.manifest.name}
              description={a.manifest.description}
              trailing={
                <Checkbox
                  checked={enabledAppletIds.includes(a.manifest.id)}
                />
              }
              onClick={() => onToggleApplet(a.manifest.id)}
            />
          ))
        )}
        <SelectorRow
          icon={<Settings2 size={18} />}
          label="Applet Management"
          trailing={<ChevronRight size={16} style={{ opacity: 0.5 }} />}
          onClick={() => {
            onClose();
            onNavigateAppletManagement?.();
          }}
        />
      </div>
    </Flexbox>
  );
}

// ── For ChatInput: self-contained popover content ──

export function SkillAppletPopoverContent({
  onClose,
  onNavigateSkills,
  onNavigateApplets,
}: {
  onClose: () => void;
  onNavigateSkills?: () => void;
  onNavigateApplets?: () => void;
}) {
  const state = useSkillAppletState();

  return (
    <PopoverBody
      skills={state.skills}
      builtins={state.builtins}
      applets={state.applets}
      enabledAppletIds={state.enabledAppletIds}
      onToggleSkill={state.toggleSkill}
      onToggleApplet={state.toggleApplet}
      onClose={onClose}
      onNavigateSkillHub={onNavigateSkills}
      onNavigateSkillManagement={onNavigateSkills}
      onNavigateAppletManagement={onNavigateApplets}
    />
  );
}

// ── For Agent Profile: "+ Add Skill" tag bar with popover ──

export function SkillAppletTagBar({
  onNavigateSkills,
  onNavigateApplets,
}: {
  onNavigateSkills?: () => void;
  onNavigateApplets?: () => void;
}) {
  const { token } = theme.useToken();
  const state = useSkillAppletState();
  const [open, setOpen] = useState(false);

  const enabledSkills = state.skills.filter((s) => s.enabled);
  const enabledAppletsList = state.applets.filter((a) =>
    state.enabledAppletIds.includes(a.manifest.id),
  );

  return (
    <Flexbox horizontal gap={4} align="center" style={{ flexWrap: 'wrap' }}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        placement="bottomLeft"
        content={
          <PopoverBody
            skills={state.skills}
            builtins={state.builtins}
            applets={state.applets}
            enabledAppletIds={state.enabledAppletIds}
            onToggleSkill={state.toggleSkill}
            onToggleApplet={state.toggleApplet}
            onClose={() => setOpen(false)}
            onNavigateSkillHub={onNavigateSkills}
            onNavigateSkillManagement={onNavigateSkills}
            onNavigateAppletManagement={onNavigateApplets}
          />
        }
        styles={{ content: { padding: 0, minWidth: 300, maxWidth: 340 } }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 10px',
            fontSize: 13,
            color: token.colorTextSecondary,
            cursor: 'pointer',
            borderRadius: 6,
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = token.colorFillTertiary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Plus size={12} />
          Add Skill
        </div>
      </Popover>
      {enabledSkills.map((s) => (
        <Tag
          key={s.id}
          closable
          onClose={() => state.toggleSkill(s.id, false)}
          style={{ margin: 0 }}
          icon={
            <span style={{ marginRight: 4, fontSize: 12 }}>
              {s.metaAvatar || '🔧'}
            </span>
          }
        >
          {s.metaTitle || s.name}
        </Tag>
      ))}
      {enabledAppletsList.map((a) => (
        <Tag
          key={a.manifest.id}
          closable
          onClose={() => state.toggleApplet(a.manifest.id)}
          style={{ margin: 0 }}
          icon={
            <span style={{ marginRight: 4, fontSize: 12 }}>
              {a.manifest.icon === 'Globe' ? '🌐' : '🧩'}
            </span>
          }
        >
          {a.manifest.name}
        </Tag>
      ))}
    </Flexbox>
  );
}
