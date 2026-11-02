import { Button, Icon, Spin, TextField } from '@peers-touch/ui';
import type { Conversation, Message, Moment, MomentComment, SettingEntry } from '../types';
import type { PrototypeListMemory } from '../listPresentation';
import type { SearchDemoControl } from '../searchDemo';
import { PrototypeListWindow } from '../components/PrototypeListWindow';
import copy from '../../../../../locales/en/search.json';

export interface SearchPresentation {
  query: string;
  filter: 'all' | 'messages' | 'social' | 'attachments' | 'functions';
  conversationKey: string;
  submitted: boolean;
}
export interface SearchTarget {
  conversation: Conversation;
  message: Message;
  root?: Message;
}
const key = (target: SearchTarget) => `${target.conversation.key}:${target.message.id}`;
export interface SocialSearchTarget {
  moment: Moment;
  comment?: MomentComment;
}
type Result = { kind: 'message'; target: SearchTarget } | { kind: 'social'; target: SocialSearchTarget };
const resultKey = (result: Result) => result.kind === 'message' ? key(result.target)
  : `${result.target.moment.id}:${result.target.comment?.id ?? 'post'}`;
const functions: Array<SettingEntry & { keywords: string }> = [
  { id: 'account-info', label: 'Account Info', iconId: 'circle-user', keywords: '账号 身份 account identity profile' },
  { id: 'privacy-security', label: 'Privacy and security', iconId: 'shield-check', keywords: '隐私 安全 权限 privacy security permissions' },
  { id: 'notifications', label: 'Notifications', iconId: 'bell', keywords: '通知 notifications sound' },
  { id: 'chat-settings', label: 'Chat settings', iconId: 'message-circle', keywords: '聊天 消息 存储 chat messages storage font' },
  { id: 'station-connection', label: 'Station connection', iconId: 'server', keywords: '站台 网络 station network connection' },
  { id: 'language', label: 'Language', iconId: 'languages', keywords: '语言 中文 language English Chinese' },
];

/** Shell-owned presentation; sample data never represents native proof. */
export function SearchPage({
  view, onChange, targets, socialTargets, memory, demo, onBack, onOpen, onOpenSocial, onSetting,
}: {
  view: SearchPresentation; onChange: (next: SearchPresentation) => void;
  targets: SearchTarget[]; memory: PrototypeListMemory; demo?: SearchDemoControl;
  socialTargets: SocialSearchTarget[]; onOpenSocial: (target: SocialSearchTarget) => void;
  onBack: () => void; onOpen: (target: SearchTarget) => void;
  onSetting: (setting: SettingEntry) => void;
}) {
  const words = view.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const status = demo?.state.status ?? (words.length ? 'results' : 'idle');
  const matches = (text: string) => words.every(word => text.toLocaleLowerCase().includes(word));
  const messageRows = targets.filter(target => !target.message.recalled && !target.message.moderated
    && view.filter !== 'social'
    && (!view.conversationKey || target.conversation.key === view.conversationKey)
    && matches(view.filter === 'attachments' ? target.message.file?.name ?? ''
      : `${target.message.text ?? ''} ${target.message.file?.name ?? ''}`));
  const socialRows = socialTargets.filter(target => !view.conversationKey
    && (view.filter === 'all' || view.filter === 'social')
    && view.submitted
    && matches(target.comment?.text ?? target.moment.text));
  const rows: Result[] = [
    ...messageRows.map(target => ({ kind: 'message' as const, target })),
    ...socialRows.map(target => ({ kind: 'social' as const, target })),
  ];
  const shown = demo && status !== 'results' ? [] : view.submitted ? rows : rows.slice(0, 12);
  const submit = () => {
    onChange({ ...view, submitted: true });
    demo?.dispatch({ type: 'submit', owner: 'global-search', query: view.query });
  };
  return <div className="mp-page mp-global-search" data-prototype-page="search" data-demo-search-status={status}>
    <header className="mp-header">
      <button type="button" className="mp-header-action" aria-label="Back" onClick={onBack}>
        <Icon iconId="arrow-left" size={20} />
      </button>
      <h1 className="mp-header-title">{copy['search.mobile.entry']}</h1>
      <button type="button" className="mp-header-action" aria-label={copy['search.refresh']} onClick={submit} disabled={!words.length}>
        <Icon iconId="search" size={20} />
      </button>
    </header>
    <form className="mp-global-search-controls" onSubmit={event => { event.preventDefault(); submit(); }}>
      <TextField
        aria-label={copy['search.label']}
        placeholder={copy['search.mobile.placeholder']}
        value={view.query}
        autoFocus
        clearable
        onClear={() => onChange({ ...view, query: '', submitted: false })}
        leading={<Icon iconId="search" size={17} />}
        onValueChange={(value) => {
          onChange({ ...view, query: value, submitted: false });
          demo?.dispatch({ type: 'edit', owner: 'global-search' });
        }}
      />
      <div className="mp-global-search-filters" role="group" aria-label={copy['search.range']}>
        {(['all', 'messages', 'social', 'attachments', 'functions'] as const).map(filter =>
          <button key={filter} type="button" data-search-filter={filter} aria-pressed={view.filter === filter}
            onClick={() => {
              onChange({ ...view, filter, submitted: filter !== 'functions' });
              if (filter !== 'functions') {
                demo?.dispatch({ type: 'submit', owner: 'global-search', query: view.query });
              }
            }}>{copy[`search.tab.${filter}`]}</button>)}
      </div>
      <div className="mp-global-search-scope">
        <span>{copy[view.conversationKey ? 'search.mobile.currentConversation' : 'search.mobile.allConversations']}</span>
        {view.conversationKey ? <Button actionId="search.expand-scope" emphasis="quiet" density="compact"
          onActivate={() => onChange({ ...view, conversationKey: '' })}>{copy['search.mobile.expandScope']}</Button> : null}
      </div>
    </form>
    <div className="mp-global-search-viewport">
      {status === 'loading' ? <div className="mp-global-search-state" role="status"><Spin />{copy['search.loading']}</div>
        : status === 'error' ? <div className="mp-global-search-state" role="alert">
          {copy['search.error.unavailable']}<Button actionId="search.retry" density="compact" onActivate={submit}>Retry</Button>
        </div> : <>
          {!words.length ? <div className="mp-global-search-state">{copy['search.mobile.initial']}</div> : null}
          {words.length && view.filter !== 'functions' ? <>
            <p className="mp-global-search-coverage" role="status">{copy['search.coverage.historyBoundary']}</p>
            {!view.conversationKey && view.submitted && (view.filter === 'all' || view.filter === 'social') ? <p className="mp-global-search-coverage" role="status">
              {copy['search.coverage.social_acquired']} · {copy['search.coverage.social_public']}
            </p> : null}
            {status === 'empty' || !shown.length ? <div className="mp-global-search-state" role="status">
              {copy['search.empty.title'].replace('{{query}}', view.query)}<span>{copy['search.empty.detail']}</span>
            </div> : <PrototypeListWindow items={shown} itemKey={resultKey} size={100} memory={memory}
              surfaceKey={`search:${view.query}:${view.filter}:${view.conversationKey}`}>
              {window => window.map(result => <button key={resultKey(result)} type="button"
                className="mp-global-search-row" data-scroll-anchor-id={resultKey(result)}
                onClick={() => result.kind === 'message' ? onOpen(result.target) : onOpenSocial(result.target)}>
                {result.kind === 'social' ? <Icon iconId="newspaper" size={20} />
                  : result.target.message.file ? <Icon iconId="file-text" size={20} /> : <Icon iconId="message-circle" size={20} />}
                <span>
                  <strong>{result.kind === 'message'
                    ? result.target.message.file?.name || result.target.message.text || result.target.message.file?.name
                    : result.target.comment?.text ?? result.target.moment.text}</strong>
                  <small>{result.kind === 'message'
                    ? [
                        result.target.message.mine
                          ? 'You'
                          : (result.target.conversation.isGroup ? result.target.conversation.name : ''),
                        result.target.message.time,
                      ].filter(Boolean).join(' · ')
                    : <>{result.target.comment ? result.target.moment.text : null}
                      {`${result.target.comment ? ' · ' : ''}${copy[result.target.comment ? 'search.kind.socialComment' : 'search.kind.socialPost']} · ${result.target.comment?.name ?? result.target.moment.name} · ${result.target.moment.audience} · ${copy[result.target.moment.audience === 'Public' ? 'search.zone.station' : 'search.zone.device']}`}</>}
                  </small>
                </span>
                <span className="mp-row-chevron"><Icon iconId="chevron-right" size={18} /></span>
              </button>)}
            </PrototypeListWindow>}
          </> : null}
          {view.filter === 'all' || view.filter === 'functions' ? <section aria-label={copy['search.quickFunctions']}>
            <p className="mp-global-search-coverage">{copy['search.quickFunctions']}</p>
            {functions.filter(item => matches(item.keywords)).map(item => <button key={item.id} type="button"
              className="mp-global-search-row" onClick={() => onSetting(item)}>
              <Icon iconId={item.iconId} size={20} />
              <span><strong>{item.label}</strong><small>Settings</small></span>
              <span className="mp-row-chevron"><Icon iconId="chevron-right" size={18} /></span>
            </button>)}
          </section> : null}
        </>}
    </div>
  </div>;
}
