import { useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@lobehub/ui';
import { FileText, FlaskConical, FolderInput, PackageOpen, RefreshCw, Search } from 'lucide-react';
import {
  canOpenApplet, catalogInventory,
  type AppletCatalogAdapter, type CatalogApplet,
} from './appletCatalogAdapter';
import './styles.css';

export function AppletIdentity({ applet }: { applet: CatalogApplet }) {
  const Icon = applet.id === 'peers.note' ? FileText : applet.id === 'peers.atelier' ? FlaskConical : PackageOpen;
  return <span className={`catalog-identity ${applet.id === 'peers.atelier' ? 'catalog-atelier' : 'catalog-note'}`}>
    <Icon size={30} />
  </span>;
}

/** One launch surface over an injected catalog; no embedded inventory or fake runtime. */
export function AppletWorkspacePage({ adapter, onOpen }: { adapter: AppletCatalogAdapter; onOpen: (id: string) => void }) {
  const projection = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot);
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const inventory = useMemo(() => catalogInventory(projection), [projection]);
  const matches = (applet: CatalogApplet) => `${applet.id} ${applet.name} ${applet.description}`
    .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const installed = inventory.filter(item => item.status !== 'available' && item.status !== 'revoked' && matches(item));
  const catalog = inventory.filter(item => (item.status === 'available' || item.status === 'revoked') && matches(item));
  const pending = projection.state === 'loading';
  const run = async (command: () => Promise<void>, message: string) => {
    setFeedback('');
    try { await command(); setFeedback(message); } catch { /* Adapter owns the recoverable error. */ }
  };
  return <main className="catalog-page" aria-label="Applet launcher">
    <header className="catalog-header">
      <h1>小程序</h1>
      <div className="catalog-actions">
        <label className="catalog-search">
          <Search size={16} aria-hidden />
          <input aria-label="搜索小程序" placeholder="搜索小程序" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        <Button icon={<RefreshCw size={16} />} aria-label="刷新小程序"
          disabled={pending || !adapter.capabilities.refresh}
          onClick={() => void run(adapter.refresh, '目录已刷新')} />
        <Button icon={<FolderInput size={16} />} disabled={pending || !adapter.capabilities.importDirectory}
          onClick={() => void run(adapter.importDirectory, '目录已导入')}>导入目录</Button>
      </div>
    </header>
    <div className="catalog-feedback" aria-live="polite" role={projection.error ? 'alert' : 'status'}>
      {projection.error || (projection.stationUnavailable ? 'Station 小程序商店暂不可用。重连后刷新目录。' : feedback)}
    </div>
    <div className="catalog-content" aria-busy={pending}>
      {pending && inventory.length === 0 ? <div className="catalog-empty" role="status">正在加载小程序…</div> : <>
        <section aria-label="我的小程序">
          <h2>我的小程序</h2>
          {installed.length ? <div className="catalog-grid">
            {installed.map(applet => <button className="catalog-tile" key={applet.id} data-applet-id={applet.id}
              disabled={pending || !canOpenApplet(applet)} onClick={() => onOpen(applet.id)} aria-label={`打开 ${applet.name}`}>
              <AppletIdentity applet={applet} />
              <span className="catalog-name">{applet.name}</span>
              {applet.status === 'disabled' ? <span className="catalog-caption">已停用</span> : null}
            </button>)}
          </div> : <div className="catalog-empty">{query ? '没有匹配的小程序。' : '暂无已安装的小程序。'}</div>}
        </section>
        <section aria-label="可添加的小程序">
          <h2>可添加的小程序</h2>
          {catalog.length ? <div className="catalog-grid">
            {catalog.map(applet => <div className="catalog-entry" key={applet.id} data-applet-id={applet.id}>
              <AppletIdentity applet={applet} />
              <span className="catalog-name">{applet.name}</span>
              <span className="catalog-caption" aria-hidden={applet.status !== 'revoked' && applet.compatible}>
                {applet.status === 'revoked' ? '已撤销' : !applet.compatible ? '不支持 Desktop' : ''}
              </span>
              <Button size="small" aria-label={`安装 ${applet.name}`}
                disabled={pending || !adapter.capabilities.install || !canOpenApplet(applet)}
                onClick={() => void run(() => adapter.install(applet.id), `${applet.name} 已安装`)}>安装</Button>
            </div>)}
          </div> : <div className="catalog-empty">{query ? '没有匹配的目录条目。' : '暂无可添加的小程序。'}</div>}
        </section>
      </>}
    </div>
    {!adapter.capabilities.importDirectory ? <p className="catalog-caption catalog-import-hint">
      导入目录需要本机文件选择器。
    </p> : null}
  </main>;
}
