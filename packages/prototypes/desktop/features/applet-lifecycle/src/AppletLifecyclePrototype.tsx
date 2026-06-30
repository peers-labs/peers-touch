import { useMemo, useState, type ChangeEvent, type CSSProperties } from 'react';
import { DesktopShell } from '@peers-touch/prototype-desktop-shell';
import {
  Bell,
  Code2,
  FileInput,
  Folder,
  PackageCheck,
  PenLine,
  Plus,
  Search,
  Sparkles,
  TerminalSquare,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

type AppletState = 'installed' | 'running' | 'notice';

interface AppletItem {
  id: string;
  name: string;
  icon: LucideIcon;
  identityClass: string;
  state: AppletState;
  source: 'bundled' | 'package';
  installedAt: number;
  lastUsedAt?: number;
  notice?: number;
}

const initialApplets: AppletItem[] = [
  {
    id: 'note',
    name: 'Note',
    icon: PenLine,
    identityClass: 'identity-note',
    state: 'running',
    source: 'bundled',
    installedAt: 5,
    lastUsedAt: 30,
    notice: 2,
  },
  {
    id: 'atelier',
    name: 'Atelier',
    icon: Sparkles,
    identityClass: 'identity-atelier',
    state: 'installed',
    source: 'bundled',
    installedAt: 4,
    lastUsedAt: 18,
  },
  {
    id: 'remote-cli',
    name: 'Remote CLI',
    icon: TerminalSquare,
    identityClass: 'identity-terminal',
    state: 'running',
    source: 'package',
    installedAt: 10,
    lastUsedAt: 24,
  },
  {
    id: 'files',
    name: 'Files',
    icon: Folder,
    identityClass: 'identity-files',
    state: 'installed',
    source: 'package',
    installedAt: 9,
  },
  {
    id: 'tools',
    name: 'Tools',
    icon: Wrench,
    identityClass: 'identity-tools',
    state: 'running',
    source: 'package',
    installedAt: 8,
    lastUsedAt: 20,
    notice: 1,
  },
  {
    id: 'sdk-lab',
    name: 'SDK Lab',
    icon: Code2,
    identityClass: 'identity-sdk',
    state: 'installed',
    source: 'package',
    installedAt: 7,
  },
  {
    id: 'imported',
    name: 'Imported',
    icon: PackageCheck,
    identityClass: 'identity-imported',
    state: 'installed',
    source: 'package',
    installedAt: 6,
  },
];

function AppletLifecyclePage() {
  const [applets, setApplets] = useState(initialApplets);
  const [selectedId, setSelectedId] = useState('note');
  const [query, setQuery] = useState('');
  const [runningExpanded, setRunningExpanded] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedDirectory, setSelectedDirectory] = useState('');
  const [selectedBundle, setSelectedBundle] = useState('');
  const selected = useMemo(
    () => applets.find((applet) => applet.id === selectedId) ?? applets[0],
    [applets, selectedId],
  );
  const visibleApplets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return applets
      .filter((applet) => (normalized ? applet.name.toLowerCase().includes(normalized) : true))
      .sort((a, b) => (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1) || b.installedAt - a.installedAt);
  }, [applets, query]);
  const runningApplets = useMemo(
    () =>
      applets
        .filter((applet) => applet.state === 'running')
        .sort((a, b) => (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1)),
    [applets],
  );

  const importPackage = (bundleName = 'Applet Bundle') => {
    const id = `pkg-${applets.length + 1}`;
    const name = bundleName.replace(/\.js$/i, '') || `Package ${applets.length + 1}`;
    setApplets((items) => [
      ...items,
      {
        id,
        name,
        icon: FileInput,
        identityClass: 'identity-package',
        state: 'installed',
        source: 'package',
        installedAt: Date.now(),
      },
    ]);
    setSelectedId(id);
  };

  const openImportDialog = () => {
    setImportMenuOpen(false);
    setImportDialogOpen(true);
    setSelectedDirectory('');
    setSelectedBundle('');
  };

  const handleDirectoryPick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    const jsBundle = files.find((file) => file.name.endsWith('.js'));
    const firstPath = files[0]?.webkitRelativePath;

    setSelectedDirectory(firstPath ? firstPath.split('/')[0] : 'Local directory');
    setSelectedBundle(jsBundle?.name ?? '');
  };

  const confirmImport = () => {
    if (!selectedBundle) return;
    importPackage(selectedBundle);
    setImportDialogOpen(false);
  };

  const openApplet = (id: string) => {
    setSelectedId(id);
    setApplets((items) =>
      items.map((item) =>
        item.id === id ? { ...item, state: 'running', lastUsedAt: Date.now(), notice: item.notice ?? 0 } : item,
      ),
    );
  };

  const stopApplet = (id: string) => {
    setApplets((items) => items.map((item) => (item.id === id ? { ...item, state: 'installed' } : item)));
    setRunningExpanded(false);
  };

  return (
    <main className="launcher-page">
      <header className="launcher-header">
        <label className="search-field">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Applet" />
        </label>
        <div className="import-menu-wrap">
          <button
            className="import-button"
            aria-label="开发者导入"
            onClick={() => setImportMenuOpen((open) => !open)}
          >
            <Plus size={16} />
          </button>
          {importMenuOpen ? (
            <div className="import-menu">
              <button onClick={openImportDialog}>
                <FileInput size={15} />
                安装包导入
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <section className="launcher-grid" aria-label="我的 Applet">
        {visibleApplets.map((applet) => (
          <AppletIcon
            key={applet.id}
            applet={applet}
            selected={selected?.id === applet.id}
            onClick={() => openApplet(applet.id)}
          />
        ))}
      </section>

      {runningApplets.length > 0 ? (
        <RunningStack
          applets={runningApplets}
          expanded={runningExpanded}
          onToggle={() => setRunningExpanded((expanded) => !expanded)}
          onOpen={openApplet}
          onStop={stopApplet}
        />
      ) : null}

      {!selected ? (
        <section className="empty-state">
          <FileInput size={30} />
          <strong>还没有 Applet</strong>
          <button onClick={openImportDialog}>导入安装包</button>
        </section>
      ) : null}

      {importDialogOpen ? (
        <section className="import-dialog-backdrop" role="dialog" aria-modal="true" aria-label="安装包导入">
          <div className="import-dialog">
            <header>
              <div>
                <strong>安装包导入</strong>
                <span>暂只支持本地目录。</span>
              </div>
              <button onClick={() => setImportDialogOpen(false)}>×</button>
            </header>

            <label className="directory-picker">
              <FileInput size={24} />
              <span>选择本地目录</span>
              <small>目录内必须包含符合 applet 协议的 JS bundle 文件。</small>
              <input
                type="file"
                multiple
                onChange={handleDirectoryPick}
                {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)}
              />
            </label>

            <div className="bundle-check">
              <span>目录</span>
              <strong>{selectedDirectory || '未选择'}</strong>
            </div>
            <div className={`bundle-check ${selectedBundle ? 'ok' : 'missing'}`}>
              <span>JS bundle</span>
              <strong>{selectedBundle || '未识别 .js bundle'}</strong>
            </div>

            <footer>
              <button className="plain-button" onClick={() => setImportDialogOpen(false)}>
                取消
              </button>
              <button className="confirm-button" disabled={!selectedBundle} onClick={confirmImport}>
                导入
              </button>
            </footer>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function RunningStack({
  applets,
  expanded,
  onToggle,
  onOpen,
  onStop,
}: {
  applets: AppletItem[];
  expanded: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
  onStop: (id: string) => void;
}) {
  return (
    <section className={`running-switcher ${expanded ? 'expanded' : ''}`} aria-label="运行中的 Applet">
      <div className="running-stage">
        {applets.map((applet, index) => (
          <RunningPreview
            key={applet.id}
            applet={applet}
            compact={!expanded}
            index={index}
            total={applets.length}
            onOpen={() => onOpen(applet.id)}
            onStop={() => onStop(applet.id)}
          />
        ))}
      </div>
      <button className="running-dots" aria-label="显示运行中的 Applet" onClick={onToggle}>
        {applets.map((applet) => (
          <span key={applet.id} />
        ))}
      </button>
    </section>
  );
}

function RunningPreview({
  applet,
  compact,
  index,
  total,
  onOpen,
  onStop,
}: {
  applet: AppletItem;
  compact: boolean;
  index: number;
  total: number;
  onOpen: () => void;
  onStop: () => void;
}) {
  const Icon = applet.icon;
  const offset = index - (total - 1) / 2;
  const compactWidth = total <= 1 ? 246 : total === 2 ? 226 : total === 3 ? 204 : total === 4 ? 188 : Math.max(154, 700 / total);
  const compactHeight = Math.round(compactWidth * 0.62);
  const compactSpacing = compactWidth * (total <= 3 ? 0.58 : 0.48);
  const expandedSpacing = Math.min(190, Math.max(132, 680 / total));

  return (
    <article
      className="running-preview"
      style={
        {
          '--x': `${offset * (compact ? compactSpacing : expandedSpacing)}px`,
          '--scale': `${1 - Math.abs(offset) * (compact ? 0.035 : 0.04)}`,
          '--z': `${total * 10 - Math.round(Math.abs(offset) * 10)}`,
          '--card-w': compact ? `${compactWidth}px` : '292px',
          '--card-h': compact ? `${compactHeight}px` : '250px',
        } as CSSProperties
      }
      onClick={onOpen}
    >
      <header>
        <span className={`running-preview-icon ${applet.identityClass}`}>
          <Icon size={17} />
        </span>
        <div>
          <strong>{applet.name}</strong>
          <small>运行中</small>
        </div>
        <button
          aria-label={`退出 ${applet.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onStop();
          }}
        >
          ×
        </button>
      </header>
      <AppletSnapshot applet={applet} />
    </article>
  );
}

function AppletSnapshot({ applet }: { applet: AppletItem }) {
  const Icon = applet.icon;

  return (
    <div className="applet-snapshot">
      <div className="snapshot-rail">
        <span />
        <span />
        <span />
      </div>
      <div className="snapshot-main">
        <div className="snapshot-topline">
          <span className="snapshot-title">{applet.name}</span>
          {applet.notice ? (
            <span className="snapshot-notice">
              <Bell size={11} />
              {applet.notice}
            </span>
          ) : null}
        </div>
        <div className="snapshot-hero">
          <span className={applet.identityClass}>
            <Icon size={20} />
          </span>
          <i />
        </div>
        <div className="snapshot-lines">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

function AppletIcon({
  applet,
  selected,
  onClick,
}: {
  applet: AppletItem;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = applet.icon;

  return (
    <button className={`applet-icon ${selected ? 'selected' : ''}`} onClick={onClick}>
      <span className={`icon-tile ${applet.identityClass}`}>
        <Icon size={30} />
        {applet.state === 'running' ? <i className="running-dot" /> : null}
        {applet.notice ? <em>{applet.notice}</em> : null}
      </span>
      <span>{applet.name}</span>
    </button>
  );
}

export function AppletLifecyclePrototype() {
  return <DesktopShell initialPage="applets" pages={{ applets: () => <AppletLifecyclePage /> }} />;
}

export default AppletLifecyclePrototype;
