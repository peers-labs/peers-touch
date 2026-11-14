import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button, Dialog, FocusBoundary, Form, FormField, InlineEdit, TextArea, TextField, UIProvider,
} from '@peers-touch/ui';
import { MobileNorthStarProvider } from '../../src/app/MobileNorthStarProvider';
import { MobileI18nProvider } from '../../src/app/mobileI18n';
import { MobileChatComposer } from '../../src/pages/chat/MobileChatComposer';
import { FindPeopleSurface } from '../../src/pages/contacts/FindPeopleSurface';
import { MomentsHeader } from '../../src/pages/moments/MomentsHeader';
import { SocialCirclesContent } from '../../src/pages/moments/SocialCirclesContent';
import { ScopeExitDraftDecisionOverlay } from '../../src/components/recovery/ScopeExitDraftDecisionOverlay';
import { ChatPage } from '../../src/pages/ChatPage';
import { MobileNavigationHost } from '../../src/components/MobileNavigationHost';
import {
  chatSurfaceFixtureRouteKind, setChatSurfaceFixture, type ChatSurfaceFixtureId,
} from '../../src/acceptance/chatSurfaceFixture';
import '../../src/styles.css';
import '../../src/pages/moments/Moments.css';

// Actual components with controlled data, no Station/native resource acquisition.
function Fixture() {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [draft, setDraft] = useState('kept draft');
  const [context, setContext] = useState<'reply' | 'edit' | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [boundary, setBoundary] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const panels = useRef<HTMLDivElement>(null);
  return <MobileI18nProvider>
    <MomentsHeader pane="feed" searchOpen={searchOpen} query={query}
      onQueryChange={setQuery} onSearchOpenChange={setSearchOpen}
      onPaneChange={() => {}} onAdd={() => {}} onOpenSearch={() => {}}
      onOpenGlobalSearch={() => {}} onOpenExplore={() => {}} onOpenNotifications={() => {}} />
    <div style={{ height: 180 }}>
      <FindPeopleSurface query={query} scope={{ kind: 'station' }} federations={[]}
        results={[]} loading={false} feedback="idle" actions={{}}
        onQueryChange={setQuery} onScopeChange={() => {}} onSearch={() => {}} onBack={() => {}} />
    </div>
    <SocialCirclesContent query="" header={open => (
      <Button actionId="fixture.circle" onActivate={open}>Create circle</Button>
    )} onOpenCircle={() => {}} />
    <nav>
      <Button actionId="fixture.reply" onActivate={() => setContext('reply')}>Reply</Button>
      <Button actionId="fixture.edit" onActivate={() => { setDraft('edit text'); setContext('edit'); }}>Edit</Button>
      <Button actionId="fixture.dialog" onActivate={() => setDialog(true)}>Open dialog</Button>
      <Button actionId="fixture.recovery" onActivate={() => setRecovery(true)}>Open recovery</Button>
      <Button actionId="fixture.boundary" onActivate={() => setBoundary(value => !value)}>Toggle boundary</Button>
      <InlineEdit value="Rename" label="Name" onCommit={() => {}} />
    </nav>
    <MobileChatComposer draft={draft} placeholder="Write message" title="Conversation"
      inputRef={input} composerRef={composer} inputPanelRef={panels}
      onDraftChange={setDraft} onSend={() => { setDraft(''); setContext(null); }}
      sending={false} toolsDisabled={false} inputDisabled={false}
      editing={context === 'edit'} keyboardOpen={false}
      context={context ? { text: context, onCancel: () => setContext(null) } : undefined}
      onChooseFile={() => {}} onTakePhoto={() => {}} onRecordVoice={() => {}}
      emojiOpen={emojiOpen} onEmojiOpenChange={setEmojiOpen}
      recentEmojis={[]} onEmojiUsed={() => {}} />
    <Dialog open={dialog} title="Write a name" onDismiss={() => setDialog(false)}>
      <TextField aria-label="Dialog input" autoFocus />
      <TextArea aria-label="Dialog multiline" autoFocus />
    </Dialog>
    {boundary && <FocusBoundary active>
      <TextField aria-label="Boundary input" autoFocus />
      <Button actionId="fixture.boundary.close" onActivate={() => setBoundary(false)}>Close boundary</Button>
    </FocusBoundary>}
    <Form initialValues={{ name: '' }}>
      <FormField name="name" label="Required name" rules={[{ required: true, message: 'Name required' }]}>
        <TextField />
      </FormField>
      <button type="submit">Validate</button>
    </Form>
    {recovery && <ScopeExitDraftDecisionOverlay reason="logout" draftCount={1}
      committedDisposition={null} canCancel t={key => key}
      onDecision={async () => { setRecovery(false); }} onCancel={async () => { setRecovery(false); }} />}
  </MobileI18nProvider>;
}

const automatic = new URLSearchParams(location.search).has('automatic');
const chatSurfaces = new URLSearchParams(location.search).has('chat-surfaces');

function ChatSurfaceFixture() {
  const [surface, setSurface] = useState<ChatSurfaceFixtureId>('chat.list-empty');
  const kind = chatSurfaceFixtureRouteKind(surface);
  Object.assign(window, { selectChatSurface: (next: ChatSurfaceFixtureId) => {
    setChatSurfaceFixture(next);
    setSurface(next);
  } });
  const page = (activeDetail: Parameters<typeof ChatPage>[0]['activeDetail']) => (
    <ChatPage activeDetail={activeDetail} onStartConversation={() => {}}
      onOpenConversation={() => {}} onBack={() => {}} listHeader={<></>} />
  );
  return <MobileI18nProvider>
    <MobileNavigationHost
      primary={{ key: 'tab:chat', content: page(null) }}
      details={kind === 'list' ? [] : [{
        key: `detail:${kind}`,
        content: page(kind === 'group'
          ? { routeId: 'detail:group-conversation', groupUlid: 'acceptance-group' }
          : { routeId: 'detail:chat-conversation', sessionUlid: 'acceptance-direct' }),
      }]}
    />
  </MobileI18nProvider>;
}

if (chatSurfaces) setChatSurfaceFixture('chat.list-empty');
createRoot(document.getElementById('root')!).render(chatSurfaces
  ? <MobileNorthStarProvider><ChatSurfaceFixture /></MobileNorthStarProvider>
  : automatic
  ? <UIProvider><Fixture /></UIProvider>
  : <MobileNorthStarProvider><Fixture /></MobileNorthStarProvider>);
