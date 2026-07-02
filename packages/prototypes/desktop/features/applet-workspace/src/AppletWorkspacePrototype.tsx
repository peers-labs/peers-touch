import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Folder,
  Home,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelRightOpen,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Sparkles,
  TerminalSquare,
  X,
  type LucideIcon,
} from 'lucide-react';
import './styles.css';

type AppletTone = 'note' | 'atelier' | 'terminal' | 'files' | 'tools';
type InstanceMode = 'contained' | 'immersive' | 'detached';

interface AppletDefinition {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  tone: AppletTone;
  multiInstance: boolean;
  trust: string;
}

interface AppletInstance {
  id: string;
  appletId: string;
  title: string;
  context: string;
  mode: InstanceMode;
  pinnedToSystem: boolean;
  status: 'running' | 'degraded';
}

const applets: AppletDefinition[] = [
  {
    id: 'note',
    name: 'Note',
    subtitle: '官方小程序',
    description: '会议、草稿和个人记录入口。支持多实例打开不同上下文。',
    icon: FileText,
    tone: 'note',
    multiInstance: true,
    trust: '本地存储',
  },
  {
    id: 'atelier',
    name: 'Atelier',
    subtitle: 'Agent 工作台',
    description: '多 Agent 协作、任务拆解和执行看板。',
    icon: Sparkles,
    tone: 'atelier',
    multiInstance: false,
    trust: '官方',
  },
  {
    id: 'tools',
    name: 'Tools',
    subtitle: '本地工具',
    description: '本地工具集 applet，用于轻量任务和能力调试。',
    icon: Settings2,
    tone: 'tools',
    multiInstance: false,
    trust: '本地',
  },
  {
    id: 'remote-cli',
    name: 'Remote CLI',
    subtitle: '远端命令',
    description: '连接远端工作区执行命令，默认单实例避免会话混乱。',
    icon: TerminalSquare,
    tone: 'terminal',
    multiInstance: false,
    trust: '远端',
  },
  {
    id: 'files',
    name: 'Files',
    subtitle: '文件',
    description: '浏览 applet 沙箱文件与导入产物。',
    icon: Folder,
    tone: 'files',
    multiInstance: true,
    trust: '受限文件',
  },
];

const initialInstances: AppletInstance[] = [
  {
    id: 'note-main',
    appletId: 'note',
    title: 'Note',
    context: '收件箱',
    mode: 'contained',
    pinnedToSystem: true,
    status: 'running',
  },
  {
    id: 'atelier-main',
    appletId: 'atelier',
    title: 'Atelier',
    context: '项目 Alpha',
    mode: 'contained',
    pinnedToSystem: false,
    status: 'running',
  },
];

function findApplet(appletId: string): AppletDefinition {
  return applets.find((applet) => applet.id === appletId) ?? applets[0]!;
}

function nextInstanceTitle(applet: AppletDefinition, count: number): { title: string; context: string } {
  if (applet.id === 'note') {
    const contexts = ['会议', '草稿', '研究'];
    return { title: `Note · ${contexts[count % contexts.length]}`, context: contexts[count % contexts.length]! };
  }
  if (applet.id === 'files') {
    const contexts = ['下载', '导入', '沙箱'];
    return { title: `Files · ${contexts[count % contexts.length]}`, context: contexts[count % contexts.length]! };
  }
  return { title: applet.name, context: '默认' };
}

export function AppletWorkspacePage() {
  const [instances, setInstances] = useState<AppletInstance[]>(initialInstances);
  const [activeTabId, setActiveTabId] = useState('home');
  const [query, setQuery] = useState('');
  const [installMenuOpen, setInstallMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');

  const activeInstance = instances.find((instance) => instance.id === activeTabId);
  const visibleApplets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return applets.filter((applet) => {
      if (!normalized) return true;
      return `${applet.name} ${applet.subtitle} ${applet.description}`.toLowerCase().includes(normalized);
    });
  }, [query]);

  const openApplet = (appletId: string, forceNew = false) => {
    const applet = findApplet(appletId);
    const existing = instances.find((instance) => instance.appletId === appletId);
    if (existing && !forceNew) {
      setActiveTabId(existing.id);
      setNotice('已切换');
      return;
    }

    const sameAppletCount = instances.filter((instance) => instance.appletId === appletId).length;
    const { title, context } = nextInstanceTitle(applet, sameAppletCount);
    const id = `${appletId}-${Date.now()}`;
    const next: AppletInstance = {
      id,
      appletId,
      title: sameAppletCount === 0 ? applet.name : title,
      context: sameAppletCount === 0 ? '默认' : context,
      mode: 'contained',
      pinnedToSystem: false,
      status: 'running',
    };
    setInstances((items) => [...items, next]);
    setActiveTabId(id);
    setInstallMenuOpen(false);
    setNotice('已打开');
  };

  const installLocalBundle = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.bundle')) {
      setNotice('仅支持 bundle');
      return;
    }
    setInstallMenuOpen(false);
    setNotice('已选择');
  };

  const closeInstance = (instanceId: string) => {
    setInstances((items) => items.filter((item) => item.id !== instanceId));
    if (activeTabId === instanceId) {
      const remaining = instances.filter((item) => item.id !== instanceId);
      setActiveTabId(remaining.at(-1)?.id ?? 'home');
    }
    setNotice('已关闭');
  };

  const patchInstance = (instanceId: string, patch: Partial<AppletInstance>, message: string) => {
    setInstances((items) => items.map((item) => (item.id === instanceId ? { ...item, ...patch } : item)));
    setNotice(message);
  };

  return (
    <main className={`workspace-page ${activeInstance?.mode === 'immersive' ? 'is-immersive' : ''}`}>
      <section className="workspace-shell" aria-label="Applet workspace">
        {activeInstance?.mode !== 'immersive' ? (
          <WorkspaceHeader
            query={query}
            installMenuOpen={installMenuOpen}
            onQueryChange={setQuery}
            onToggleInstallMenu={() => setInstallMenuOpen((open) => !open)}
            onInstallLocalBundle={installLocalBundle}
          />
        ) : null}

        {activeInstance?.mode !== 'immersive' ? (
          <TabStrip
            instances={instances}
            activeTabId={activeTabId}
            onActivate={setActiveTabId}
            onClose={closeInstance}
            onNew={() => setInstallMenuOpen(true)}
          />
        ) : null}

        <section className="workspace-stage">
          {activeTabId === 'home' || !activeInstance ? (
            <AppletHome
              applets={visibleApplets}
              instances={instances}
              query={query}
              notice={notice}
              onOpen={openApplet}
              onSetQuery={setQuery}
            />
          ) : (
            <AppletRuntimeSurface
              instance={activeInstance}
              applet={findApplet(activeInstance.appletId)}
              onPatch={(patch, message) => patchInstance(activeInstance.id, patch, message)}
              onClose={() => closeInstance(activeInstance.id)}
            />
          )}
        </section>
      </section>
    </main>
  );
}

function WorkspaceHeader({
  query,
  installMenuOpen,
  onQueryChange,
  onToggleInstallMenu,
  onInstallLocalBundle,
}: {
  query: string;
  installMenuOpen: boolean;
  onQueryChange: (value: string) => void;
  onToggleInstallMenu: () => void;
  onInstallLocalBundle: (file: File) => void;
}) {
  const bundleInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="workspace-header">
      <div>
        <h1>小程序</h1>
      </div>
      <div className="workspace-actions">
        <label className="workspace-search">
          <Search size={16} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索" />
        </label>
        <div className="quick-open-wrap">
          <button className="primary-action install-action" onClick={onToggleInstallMenu} aria-label="新增小程序">
            <Plus size={18} />
          </button>
          {installMenuOpen ? (
            <div className="quick-open-menu" role="menu">
              <button type="button" onClick={() => bundleInputRef.current?.click()}>
                从本地安装
              </button>
            </div>
          ) : null}
          <input
            ref={bundleInputRef}
            type="file"
            accept=".bundle"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                onInstallLocalBundle(file);
              }
              event.currentTarget.value = '';
            }}
          />
        </div>
      </div>
    </header>
  );
}

function TabStrip({
  instances,
  activeTabId,
  onActivate,
  onClose,
  onNew,
}: {
  instances: AppletInstance[];
  activeTabId: string;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
}) {
  return (
    <nav className="tab-strip" aria-label="Applet tabs">
      <button className={`workspace-tab home-tab ${activeTabId === 'home' ? 'is-active' : ''}`} onClick={() => onActivate('home')}>
        <Home size={15} />
        <span>主页</span>
      </button>
      <div className="tab-scroll">
        {instances.map((instance) => {
          const applet = findApplet(instance.appletId);
          return (
            <button
              key={instance.id}
              className={`workspace-tab ${activeTabId === instance.id ? 'is-active' : ''}`}
              onClick={() => onActivate(instance.id)}
            >
              <AppletMark applet={applet} compact />
              <span className="tab-title">{instance.title}</span>
              {instance.mode === 'detached' ? <ExternalLink size={13} /> : null}
              {instance.pinnedToSystem ? <Pin size={12} /> : null}
              <span className={`status-dot ${instance.status}`} />
              <span
                className="tab-close"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(instance.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(instance.id);
                  }
                }}
                aria-label={`关闭 ${instance.title}`}
              >
                <X size={13} />
              </span>
            </button>
          );
        })}
      </div>
      <button className="new-tab-button" onClick={onNew} aria-label="新增小程序">
        <Plus size={15} />
      </button>
    </nav>
  );
}

function AppletHome({
  applets: visibleApplets,
  instances,
  query,
  notice,
  onOpen,
  onSetQuery,
}: {
  applets: AppletDefinition[];
  instances: AppletInstance[];
  query: string;
  notice: string;
  onOpen: (appletId: string, forceNew?: boolean) => void;
  onSetQuery: (value: string) => void;
}) {
  const running = instances.slice().reverse();
  return (
    <div className="launcher-home">
      {notice ? (
        <section className="launcher-notice" aria-label="Applet launcher state">
          <CheckCircle2 size={15} />
          <span>{notice}</span>
        </section>
      ) : null}

      <section className="ios-applet-grid" aria-label="我的小程序">
        {visibleApplets.map((applet) => {
          const Icon = applet.icon;
          const runningCount = instances.filter((instance) => instance.appletId === applet.id).length;
          return (
            <button
              key={applet.id}
              className="ios-applet-icon"
              onClick={() => onOpen(applet.id)}
              aria-label={`打开 ${applet.name}`}
            >
              <span className={`ios-icon-tile tone-${applet.tone}`}>
                <Icon size={30} />
                {runningCount > 0 ? <i className="ios-running-dot" /> : null}
                {runningCount > 1 ? <em>{runningCount}</em> : null}
              </span>
              <span>{applet.name}</span>
            </button>
          );
        })}
      </section>

      {running.length > 0 ? (
        <section className="ios-running-switcher" aria-label="运行中的小程序">
          <div className="ios-running-stage">
            {running.map((instance, index) => (
              <RunningSnapshot
                key={instance.id}
                instance={instance}
                index={index}
                total={running.length}
                onOpen={() => onOpen(instance.appletId)}
              />
            ))}
          </div>
          <div className="ios-running-dots" aria-hidden="true">
            {running.map((instance) => (
              <span key={instance.id} />
            ))}
          </div>
        </section>
      ) : (
        <section className="ios-empty-launcher">
          <strong>暂无运行</strong>
          <button onClick={() => onSetQuery(query ? '' : 'note')}>{query ? '清除' : '筛选 Note'}</button>
        </section>
      )}
    </div>
  );
}

function RunningSnapshot({
  instance,
  index,
  total,
  onOpen,
}: {
  instance: AppletInstance;
  index: number;
  total: number;
  onOpen: () => void;
}) {
  const applet = findApplet(instance.appletId);
  const offset = index - (total - 1) / 2;
  const spread = total <= 1 ? 0 : total === 2 ? 118 : Math.max(34, 118 - (total - 2) * 18);

  return (
    <button
      className="ios-running-card"
      style={
        {
          '--x': `${offset * spread}px`,
          '--scale': `${Math.max(0.72, 1 - Math.abs(offset) * 0.07)}`,
          '--z': `${total * 10 - Math.round(Math.abs(offset) * 10)}`,
        } as CSSProperties
      }
      onClick={onOpen}
    >
      <header>
        <AppletMark applet={applet} compact />
        <div>
          <strong>{instance.title}</strong>
          <span>{instance.context}</span>
        </div>
      </header>
      <div className={`ios-snapshot-body tone-${applet.tone}`}>
        <span />
        <span />
        <span />
      </div>
    </button>
  );
}

function AppletRuntimeSurface({
  instance,
  applet,
  onPatch,
  onClose,
}: {
  instance: AppletInstance;
  applet: AppletDefinition;
  onPatch: (patch: Partial<AppletInstance>, message: string) => void;
  onClose: () => void;
}) {
  if (instance.mode === 'detached') {
    return (
      <div className="detached-state">
        <AppletMark applet={applet} />
        <h2>已分离</h2>
        <div className="runtime-actions">
          <button onClick={() => onPatch({ mode: 'contained' }, '已恢复')}>
            <PanelRightOpen size={15} />
            回到工作台
          </button>
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`runtime-surface tone-${applet.tone} ${instance.mode === 'immersive' ? 'is-immersive' : ''}`}>
      <RuntimeToolbar
        instance={instance}
        applet={applet}
        onPatch={onPatch}
        onClose={onClose}
      />
      <div className="runtime-content">
        <MockAppletContent applet={applet} instance={instance} />
      </div>
    </div>
  );
}

function RuntimeToolbar({
  instance,
  applet,
  onPatch,
  onClose,
}: {
  instance: AppletInstance;
  applet: AppletDefinition;
  onPatch: (patch: Partial<AppletInstance>, message: string) => void;
  onClose: () => void;
}) {
  const togglePin = () => {
    const next = !instance.pinnedToSystem;
    onPatch({ pinnedToSystem: next }, next ? '已固定' : '已取消固定');
  };

  if (instance.mode === 'immersive') {
    return (
      <div className="immersive-controls">
        <button onClick={() => onPatch({ mode: 'contained' }, '已退出')}>
          <Minimize2 size={15} />
          退出
        </button>
        <button onClick={togglePin}>{instance.pinnedToSystem ? <PinOff size={15} /> : <Pin size={15} />}</button>
        <button onClick={onClose}>
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <header className="runtime-toolbar">
      <div className="runtime-title">
        <AppletMark applet={applet} compact />
        <div>
          <strong>{instance.title}</strong>
          <span>{instance.context} · {applet.trust}</span>
        </div>
      </div>
      <div className="runtime-actions">
        <button onClick={togglePin}>
          {instance.pinnedToSystem ? <PinOff size={15} /> : <Pin size={15} />}
          {instance.pinnedToSystem ? '取消固定' : '固定'}
        </button>
        <button onClick={() => onPatch({ mode: 'detached' }, '已分离')}>
          <ExternalLink size={15} />
          分离
        </button>
        <button onClick={() => onPatch({ mode: 'immersive' }, '沉浸')}>
          <Maximize2 size={15} />
          沉浸
        </button>
        <button className="icon-button" aria-label="更多">
          <MoreHorizontal size={16} />
        </button>
      </div>
    </header>
  );
}

function MockAppletContent({ applet, instance }: { applet: AppletDefinition; instance: AppletInstance }) {
  const rows: Record<string, ReactNode> = {
    note: (
      <>
        <div className="mock-editor-title">会议记录</div>
        <div className="mock-editor-line wide" />
        <div className="mock-editor-line" />
        <div className="mock-editor-line short" />
      </>
    ),
    atelier: (
      <>
        <div className="agent-column">
          <span>计划</span>
          <strong>拆任务</strong>
        </div>
        <div className="agent-column">
          <span>执行</span>
          <strong>执行中</strong>
        </div>
        <div className="agent-column">
          <span>检查</span>
          <strong>等待证据</strong>
        </div>
      </>
    ),
    'remote-cli': (
      <>
        <code>$ make desktop</code>
        <code>runtime: ready</code>
        <code>gateway: ready</code>
      </>
    ),
    files: (
      <>
        <div className="file-row"><Folder size={15} /> applet-package</div>
        <div className="file-row"><FileText size={15} /> manifest.json</div>
        <div className="file-row"><FileText size={15} /> main.lynx.bundle</div>
      </>
    ),
  };

  return (
    <section className="mock-applet">
      <div className="mock-applet-header">
        <div>
          <p className="eyebrow">{applet.subtitle}</p>
          <h2>{instance.title}</h2>
        </div>
        <div className="runtime-chip">
          {instance.status === 'degraded' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          {instance.mode}
        </div>
      </div>
      <div className={`mock-body mock-${applet.id}`}>{rows[applet.id]}</div>
      <footer className="mock-footer">
        <span>本地运行</span>
        <button>
          <Settings2 size={14} />
          详情
        </button>
      </footer>
    </section>
  );
}

function AppletMark({ applet, compact = false }: { applet: AppletDefinition; compact?: boolean }) {
  const Icon = applet.icon;
  return (
    <span className={`applet-mark tone-${applet.tone} ${compact ? 'compact' : ''}`}>
      <Icon size={compact ? 15 : 23} />
    </span>
  );
}
