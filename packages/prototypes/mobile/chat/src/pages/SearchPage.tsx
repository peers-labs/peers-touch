import { Button, Input, Spin } from 'antd';
import { ArrowLeft, ChevronRight, FileText, MessageCircle, RefreshCw, Search, Settings } from 'lucide-react';
import type { Conversation, Message, SettingEntry } from '../types';
import type { PrototypeListMemory } from '../listPresentation';
import type { SearchDemoControl } from '../searchDemo';
import { PrototypeListWindow } from '../components/PrototypeListWindow';
import copy from '../../../../../locales/en/search.json';
import './SearchPage.css';

export interface SearchPresentation {
  query: string;
  filter: 'all' | 'messages' | 'attachments' | 'functions';
  conversationKey: string;
  submitted: boolean;
}
export interface SearchTarget {
  conversation: Conversation;
  message: Message;
  root?: Message;
}
const key = (target: SearchTarget) => `${target.conversation.key}:${target.message.id}`;
const functions: Array<SettingEntry & { keywords: string }> = [
  { id: 'account-info', label: 'Account Info', icon: Settings, tint: 'primary', keywords: '账号 身份 account identity profile' },
  { id: 'privacy-security', label: 'Privacy and security', icon: Settings, tint: 'primary', keywords: '隐私 安全 权限 privacy security permissions' },
  { id: 'notifications', label: 'Notifications', icon: Settings, tint: 'primary', keywords: '通知 notifications sound' },
  { id: 'chat-settings', label: 'Chat settings', icon: Settings, tint: 'primary', keywords: '聊天 消息 存储 chat messages storage font' },
  { id: 'station-connection', label: 'Station connection', icon: Settings, tint: 'primary', keywords: '站台 网络 station network connection' },
  { id: 'language', label: 'Language', icon: Settings, tint: 'primary', keywords: '语言 中文 language English Chinese' },
];

/** Shell-owned presentation; sample data never represents native proof. */
export function SearchPage({
  view, onChange, targets, memory, demo, onBack, onOpen, onSetting,
}: {
  view: SearchPresentation; onChange: (next: SearchPresentation) => void;
  targets: SearchTarget[]; memory: PrototypeListMemory; demo?: SearchDemoControl;
  onBack: () => void; onOpen: (target: SearchTarget) => void;
  onSetting: (setting: SettingEntry) => void;
}) {
  const words = view.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const status = demo?.state.status ?? (words.length ? 'results' : 'idle');
  const matches = (text: string) => words.every(word => text.toLocaleLowerCase().includes(word));
  const rows = targets.filter(target => !target.message.recalled && !target.message.moderated
    && (!view.conversationKey || target.conversation.key === view.conversationKey)
    && matches(view.filter === 'attachments' ? target.message.file?.name ?? ''
      : `${target.message.text ?? ''} ${target.message.file?.name ?? ''}`));
  const shown = demo && status !== 'results' ? [] : view.submitted ? rows : rows.slice(0, 12);
  const submit = () => {
    onChange({ ...view, submitted: true });
    demo?.dispatch({ type: 'submit', owner: 'global-search', query: view.query });
  };
  return <div className="mp-page mp-global-search" data-prototype-page="search" data-demo-search-status={status}>
    <header className="mp-header">
      <button type="button" className="mp-header-action" aria-label="Back" onClick={onBack}><ArrowLeft size={20} /></button>
      <h1 className="mp-header-title">{copy['search.mobile.entry']}</h1>
      <button type="button" className="mp-header-action" aria-label={copy['search.refresh']} onClick={submit} disabled={!words.length}><RefreshCw size={20} /></button>
    </header>
    <form className="mp-global-search-controls" onSubmit={event => { event.preventDefault(); submit(); }}>
      <div className="mp-global-search-input">
        <Input prefix={<Search size={18} />} allowClear autoFocus aria-label={copy['search.label']} value={view.query}
          placeholder={copy['search.mobile.placeholder']} onChange={event => {
            onChange({ ...view, query: event.target.value, submitted: false });
            demo?.dispatch({ type: 'edit', owner: 'global-search' });
          }} />
        <Button type="primary" htmlType="submit">{copy['search.mobile.submit']}</Button>
      </div>
      <div className="mp-global-search-filters" role="group" aria-label={copy['search.range']}>
        {(['all', 'messages', 'attachments', 'functions'] as const).map(filter =>
          <button key={filter} type="button" aria-pressed={view.filter === filter}
            onClick={() => onChange({ ...view, filter })}>{copy[`search.tab.${filter}`]}</button>)}
      </div>
      <div className="mp-global-search-scope">
        <span>{copy[view.conversationKey ? 'search.mobile.currentConversation' : 'search.mobile.allConversations']}</span>
        {view.conversationKey ? <Button type="text" onClick={() => onChange({ ...view, conversationKey: '' })}>{copy['search.mobile.expandScope']}</Button> : null}
      </div>
    </form>
    <div className="mp-global-search-viewport">
      {status === 'loading' ? <div className="mp-global-search-state" role="status"><Spin />{copy['search.loading']}</div>
        : status === 'error' ? <div className="mp-global-search-state" role="alert">
          {copy['search.error.unavailable']}<Button onClick={submit}>Retry</Button>
        </div> : <>
          {!words.length ? <div className="mp-global-search-state">{copy['search.mobile.initial']}</div> : null}
          {words.length && view.filter !== 'functions' ? <>
            <p className="mp-global-search-coverage" role="status">{copy['search.coverage.historyBoundary']}</p>
            {status === 'empty' || !shown.length ? <div className="mp-global-search-state" role="status">
              {copy['search.empty.title'].replace('{{query}}', view.query)}<span>{copy['search.empty.detail']}</span>
            </div> : <PrototypeListWindow items={shown} itemKey={key} size={100} memory={memory}
              surfaceKey={`search:${view.query}:${view.filter}:${view.conversationKey}`}>
              {window => window.map(target => <button key={key(target)} type="button"
                className="mp-global-search-row" data-scroll-anchor-id={key(target)} onClick={() => onOpen(target)}>
                {target.message.file ? <FileText size={20} /> : <MessageCircle size={20} />}
                <span><strong>{view.filter === 'attachments' ? target.message.file?.name : target.message.text || target.message.file?.name}</strong>
                  <small>{target.conversation.name} · {target.message.mine ? 'You' : target.conversation.name} · {target.message.time}</small></span>
                <ChevronRight size={18} />
              </button>)}
            </PrototypeListWindow>}
          </> : null}
          {view.filter === 'all' || view.filter === 'functions' ? <section aria-label={copy['search.quickFunctions']}>
            <p className="mp-global-search-coverage">{copy['search.quickFunctions']}</p>
            {functions.filter(item => matches(item.keywords)).map(item => <button key={item.id} type="button"
              className="mp-global-search-row" onClick={() => onSetting(item)}>
              <Settings size={20} /><span><strong>{item.label}</strong><small>Settings</small></span><ChevronRight size={18} />
            </button>)}
          </section> : null}
        </>}
    </div>
  </div>;
}
