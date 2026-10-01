import { type ReactNode, useMemo, useState } from 'react';
import './modern-chat-review.css';

type Scenario =
  | 'first-turn'
  | 'queued-followups'
  | 'tool-approval'
  | 'ask-user'
  | 'attachment-failure'
  | 'context-intelligence'
  | 'disconnect-recovery'
  | 'external-runtime-reset'
  | 'branch-regenerate'
  | 'capability-degraded'
  | 'usage-diagnostics';

const scenarios: Array<{ id: Scenario; label: string; productIds: string }> = [
  { id: 'first-turn', label: 'First turn', productIds: 'MCA-P01 / MCA-P02 / MCA-P03 - MCA-J01' },
  { id: 'queued-followups', label: 'Queue', productIds: 'MCA-P07 - MCA-J03' },
  { id: 'tool-approval', label: 'Tool approval', productIds: 'MCA-P05 - MCA-J05' },
  { id: 'ask-user', label: 'Ask user', productIds: 'MCA-P05 - MCA-J05' },
  { id: 'attachment-failure', label: 'Attachments', productIds: 'MCA-P06 - MCA-J06' },
  { id: 'context-intelligence', label: 'Context', productIds: 'MCA-P04 - MCA-J04' },
  { id: 'disconnect-recovery', label: 'Recovery', productIds: 'MCA-P07 - MCA-J07' },
  { id: 'external-runtime-reset', label: 'External runtime', productIds: 'MCA-P12 - MCA-J10' },
  { id: 'branch-regenerate', label: 'Branches', productIds: 'MCA-P08 - MCA-J08' },
  { id: 'capability-degraded', label: 'Capability', productIds: 'MCA-P09 / MCA-P11 - MCA-J09' },
  { id: 'usage-diagnostics', label: 'Diagnostics', productIds: 'MCA-P10 - MCA-J09' },
];

function scenarioFromState(state: string): Scenario {
  const normalized = state.replace(/^modern-/, '') as Scenario;
  return scenarios.some((scenario) => scenario.id === normalized) ? normalized : 'first-turn';
}

export function ModernChatReview({ initialState, withTopicRail = false }: { initialState: string; withTopicRail?: boolean }) {
  const [scenario, setScenario] = useState<Scenario>(() => scenarioFromState(initialState));
  const selected = useMemo(
    () => scenarios.find((item) => item.id === scenario) ?? scenarios[0],
    [scenario],
  );

  const review = (
    <main className="pt-modern-chat" data-modern-chat-scenario={scenario}>
      <header className="pt-modern-chat-header">
        <div>
          <span className="pt-modern-eyebrow">Modern Chat Agent</span>
          <strong>Research Agent</strong>
          <small>Station ready - Direct Model - actor scoped</small>
        </div>
        <div className="pt-modern-header-state">
          <span>Station authoritative</span>
          <button type="button">Agent profile</button>
        </div>
      </header>

      <nav className="pt-modern-scenario-nav" aria-label="Modern Chat product review states">
        {scenarios.map((item) => (
          <button
            key={item.id}
            className={item.id === scenario ? 'is-active' : ''}
            type="button"
            onClick={() => setScenario(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="pt-modern-contract-strip">
        <span>{selected.productIds}</span>
        <span>Prototype behavior only - production truth remains unproven</span>
      </div>

      <section className="pt-modern-chat-body">
        {scenario === 'first-turn' && <FirstTurnScenario />}
        {scenario === 'queued-followups' && <QueueScenario />}
        {scenario === 'tool-approval' && <ToolApprovalScenario />}
        {scenario === 'ask-user' && <AskUserScenario />}
        {scenario === 'attachment-failure' && <AttachmentScenario />}
        {scenario === 'context-intelligence' && <ContextScenario />}
        {scenario === 'disconnect-recovery' && <RecoveryScenario />}
        {scenario === 'external-runtime-reset' && <ExternalRuntimeResetScenario />}
        {scenario === 'branch-regenerate' && <BranchScenario />}
        {scenario === 'capability-degraded' && <CapabilityScenario />}
        {scenario === 'usage-diagnostics' && <DiagnosticsScenario />}
      </section>
    </main>
  );

  if (!withTopicRail) return review;

  return (
    <section className="pt-modern-chat-host">
      <aside className="pt-modern-topic-rail">
        <div><span className="pt-modern-eyebrow">Agent</span><strong>Research Agent</strong><small>Ready on Station</small></div>
        <button className="primary" type="button" onClick={() => setScenario('first-turn')}>New topic</button>
        <label><span>Topics</span><input aria-label="Search Modern Chat topics" placeholder="Search topics" /></label>
        <button className="is-active" type="button"><span>Modern Chat review</span><small>Active product topic</small></button>
        <button type="button"><span>Architecture notes</span><small>Yesterday</small></button>
        <button type="button"><span>Tool policy review</span><small>Yesterday</small></button>
      </aside>
      {review}
    </section>
  );
}

function FirstTurnScenario() {
  const [state, setState] = useState<'draft' | 'accepted' | 'streaming' | 'completed'>('draft');
  const [draft, setDraft] = useState('Reply with TEST_OK');

  return (
    <div className="pt-modern-flow">
      <StateHeading
        title="First useful answer"
        state={state}
        description="A local draft becomes a topic only after Station accepts the turn."
      />
      {state !== 'draft' && (
        <div className="pt-modern-timeline">
          <Message role="You" meta={state === 'accepted' ? 'accepted by Station' : 'persisted'}>
            {draft}
          </Message>
          {state === 'streaming' && (
            <Message role="Research Agent" meta="OpenAI / gpt-4.1 - streaming">
              TEST
              <span className="pt-modern-caret" />
            </Message>
          )}
          {state === 'completed' && (
            <Message role="Research Agent" meta="completed - turn and trace persisted">
              TEST_OK
            </Message>
          )}
        </div>
      )}
      <div className="pt-modern-composer">
        <textarea
          aria-label="First turn prompt"
          disabled={state !== 'draft'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="pt-modern-composer-actions">
          <span>{state === 'draft' ? 'Local draft - not yet in topic history' : 'Station topic topic-1042'}</span>
          {state === 'draft' && <button className="primary" type="button" onClick={() => setState('accepted')}>Send</button>}
          {state === 'accepted' && <button className="primary" type="button" onClick={() => setState('streaming')}>Project first event</button>}
          {state === 'streaming' && <button className="primary" type="button" onClick={() => setState('completed')}>Project terminal event</button>}
          {state === 'completed' && <button type="button" onClick={() => setState('draft')}>New topic</button>}
        </div>
      </div>
    </div>
  );
}

function QueueScenario() {
  const [items, setItems] = useState([
    { id: 'q1', text: 'Also compare the two approaches.', state: 'waiting' },
    { id: 'q2', text: 'Then summarize the risks.', state: 'waiting' },
  ]);
  const [editing, setEditing] = useState('');

  const promote = (id: string) => {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      return target ? [target, ...current.filter((item) => item.id !== id)] : current;
    });
  };

  return (
    <div className="pt-modern-flow">
      <StateHeading title="Queued follow-ups" state="active turn" description="Accepted follow-ups remain ordered and editable while the current turn runs." />
      <Message role="Research Agent" meta="streaming - cancel available">Reviewing the architecture and current implementation...</Message>
      <div className="pt-modern-queue" aria-label="Queued follow-up messages">
        {items.map((item, index) => (
          <article key={item.id}>
            <span>{index + 1}</span>
            {editing === item.id ? (
              <input
                aria-label={`Edit queued message ${index + 1}`}
                value={item.text}
                onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value } : entry))}
              />
            ) : (
              <p>{item.text}</p>
            )}
            <small>{item.state}</small>
            <div>
              <button type="button" onClick={() => setEditing((value) => value === item.id ? '' : item.id)}>{editing === item.id ? 'Save' : 'Edit'}</button>
              <button type="button" onClick={() => promote(item.id)}>Send next</button>
              <button className="danger" type="button" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>Remove</button>
            </div>
          </article>
        ))}
        {items.length === 0 && <div className="pt-modern-empty">Queue is empty. The current turn continues.</div>}
      </div>
    </div>
  );
}

function ToolApprovalScenario() {
  const [decision, setDecision] = useState<'pending' | 'approved' | 'denied' | 'expired'>('pending');

  return (
    <div className="pt-modern-flow">
      <StateHeading title="Tool approval" state={decision} description="The decision names authority, scope, target, and consequence before execution." />
      <article className={`pt-modern-approval is-${decision}`}>
        <div>
          <span className="pt-modern-eyebrow">Desktop capability session - device mac-studio</span>
          <strong>Read files from approved workspace</strong>
          <p>Target: Agent Notes / Product brief.md</p>
          <small>Risk: reads local content. No write or shell access. Expires in 2 minutes.</small>
        </div>
        {decision === 'pending' ? (
          <div className="pt-modern-decision-actions">
            <button type="button" onClick={() => setDecision('denied')}>Deny</button>
            <button type="button" onClick={() => setDecision('expired')}>Simulate expiry</button>
            <button className="primary" type="button" onClick={() => setDecision('approved')}>Approve once</button>
          </div>
        ) : (
          <div className="pt-modern-result">
            {decision === 'approved' && 'Approved once - one execution result is ready.'}
            {decision === 'denied' && 'Denied - the Agent continues without the file.'}
            {decision === 'expired' && 'Expired - no tool execution occurred.'}
            <button type="button" onClick={() => setDecision('pending')}>Reset review state</button>
          </div>
        )}
      </article>
    </div>
  );
}

function AskUserScenario() {
  const [answer, setAnswer] = useState('Keep the original response');
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="pt-modern-flow">
      <StateHeading title="Agent needs a decision" state={submitted ? 'answered' : 'awaiting human'} description="The blocked turn stays in one reading path and resumes with structured input." />
      <article className="pt-modern-ask-user">
        <strong>Which response should remain active?</strong>
        <p>The Agent found two valid branches and cannot choose a destructive replacement for you.</p>
        <label><input checked={answer === 'Keep the original response'} name="branch-choice" type="radio" onChange={() => setAnswer('Keep the original response')} /> Keep the original response</label>
        <label><input checked={answer === 'Use the regenerated response'} name="branch-choice" type="radio" onChange={() => setAnswer('Use the regenerated response')} /> Use the regenerated response</label>
        <button className="primary" disabled={submitted} type="button" onClick={() => setSubmitted(true)}>{submitted ? 'Submitted' : 'Submit decision'}</button>
        {submitted && <small>Answer persisted for request ask-203. Turn may resume.</small>}
      </article>
    </div>
  );
}

function AttachmentScenario() {
  const [files, setFiles] = useState([
    { id: 'f1', name: 'architecture.png', state: 'ready' },
    { id: 'f2', name: 'large-recording.mov', state: 'rejected' },
  ]);
  const readyCount = files.filter((file) => file.state === 'ready').length;

  return (
    <div className="pt-modern-flow">
      <StateHeading title="Attachment admission" state="mixed result" description="Valid resources remain usable while rejected resources explain recovery." />
      <div className="pt-modern-attachments">
        {files.map((file) => (
          <article key={file.id} className={`is-${file.state}`}>
            <div><strong>{file.name}</strong><small>{file.state === 'ready' ? 'Image - 1.2 MB - model compatible' : 'Video - 42 MB - unsupported by selected model'}</small></div>
            <span>{file.state}</span>
            {file.state === 'rejected' ? (
              <div>
                <button type="button" onClick={() => setFiles((current) => current.map((entry) => entry.id === file.id ? { ...entry, state: 'ready' } : entry))}>Choose compatible model</button>
                <button className="danger" type="button" onClick={() => setFiles((current) => current.filter((entry) => entry.id !== file.id))}>Remove</button>
              </div>
            ) : (
              <button type="button" onClick={() => setFiles((current) => current.filter((entry) => entry.id !== file.id))}>Remove</button>
            )}
          </article>
        ))}
      </div>
      <div className="pt-modern-composer compact">
        <textarea aria-label="Attachment prompt" defaultValue="Describe the architecture in the attached image." />
        <div className="pt-modern-composer-actions"><span>{readyCount} ready - rejected files are never silently omitted</span><button className="primary" type="button">Send compatible input</button></div>
      </div>
    </div>
  );
}

function ContextScenario() {
  const [selected, setSelected] = useState<'memory' | 'skill' | 'knowledge'>('memory');
  const sources = {
    memory: {
      title: 'Communication preference',
      detail: 'Memory mem-12 - concise engineering answers',
      decision: 'Included because the current request asks for an implementation recommendation.',
    },
    skill: {
      title: 'Architecture review procedure',
      detail: 'Skill skill-architecture-review@3',
      decision: 'Activated because the request asks whether the design is sufficient.',
    },
    knowledge: {
      title: 'Modern Chat product contract',
      detail: 'Knowledge kb-7 / chunk-22',
      decision: 'Retrieved from the accepted resource scope for this Agent.',
    },
  };
  const source = sources[selected];

  return (
    <div className="pt-modern-flow">
      <StateHeading title="Context intelligence" state="3 attributed sources" description="Memory, skills, and knowledge remain separate and explain why they affected the answer." />
      <Message role="Research Agent" meta="completed - context attribution available">The first vertical slice should close persistence and recovery before external Agent runtimes.</Message>
      <div className="pt-modern-context-grid">
        <nav aria-label="Context source types">
          {(['memory', 'skill', 'knowledge'] as const).map((item) => (
            <button key={item} className={selected === item ? 'is-active' : ''} type="button" onClick={() => setSelected(item)}>{item}</button>
          ))}
        </nav>
        <article>
          <span className="pt-modern-eyebrow">{selected} attribution</span>
          <strong>{source.title}</strong>
          <p>{source.detail}</p>
          <small>{source.decision}</small>
          <div className="pt-modern-result"><span>Source ID recorded in ContextLedger</span><button type="button">Open source</button></div>
        </article>
      </div>
    </div>
  );
}

function RecoveryScenario() {
  const [state, setState] = useState<'connection-lost' | 'replaying' | 'reconciled'>('connection-lost');

  return (
    <div className="pt-modern-flow">
      <StateHeading title="Disconnect and recovery" state={state} description="Transport loss does not imply turn failure; Station remains authoritative." />
      <Message role="Research Agent" meta="last durable checkpoint - sequence 18">The first two findings were persisted before the connection dropped.</Message>
      <article className="pt-modern-recovery">
        <strong>{state === 'connection-lost' ? 'Connection lost' : state === 'replaying' ? 'Replaying Station events' : 'Projection reconciled'}</strong>
        <p>
          {state === 'connection-lost' && 'The turn may still be running. No resend is required.'}
          {state === 'replaying' && 'Replaying sequences 19-27 and deduplicating previously observed events.'}
          {state === 'reconciled' && 'Terminal projection matches Station snapshot at sequence 27.'}
        </p>
        {state === 'connection-lost' && <button className="primary" type="button" onClick={() => setState('replaying')}>Reconnect</button>}
        {state === 'replaying' && <button className="primary" type="button" onClick={() => setState('reconciled')}>Apply replay and snapshot</button>}
        {state === 'reconciled' && <button type="button" onClick={() => setState('connection-lost')}>Reset review state</button>}
      </article>
    </div>
  );
}

function ExternalRuntimeResetScenario() {
  const [state, setState] = useState<
    'resume-unavailable' | 'confirming' | 'ready' | 'fresh-session'
  >('resume-unavailable');

  return (
    <div className="pt-modern-flow">
      <StateHeading
        title="External runtime recovery"
        state={state}
        description="Station preserves the failed session binding until the user confirms destructive reset."
      />
      <Message role="Research Agent" meta="external-agent - session ext-1042 - epoch 1">
        The previous runtime session cannot be resumed. Conversation history is still available.
      </Message>
      <article
        className="pt-modern-recovery"
        data-pt-prototype-external-runtime-reset={state}
      >
        <div>
          <span className="pt-modern-eyebrow">
            Authority: Station conversation runtime binding
          </span>
          <strong>
            {state === 'resume-unavailable' && 'Runtime session unavailable'}
            {state === 'confirming' && 'Reset external runtime?'}
            {state === 'ready' && 'Runtime reset complete'}
            {state === 'fresh-session' && 'Fresh runtime session created'}
          </strong>
          <p>
            {state === 'resume-unavailable'
              && 'No replacement session was started. Reset is required before the next turn.'}
            {state === 'confirming'
              && 'The unavailable external session and its runtime files will be permanently removed. Conversation history is kept.'}
            {state === 'ready'
              && 'Epoch 2 is ready with no session handle. The next turn may create a new session.'}
            {state === 'fresh-session'
              && 'Station persisted session ext-2099 under epoch 2 before projecting output.'}
          </p>
        </div>
        {state === 'resume-unavailable' && (
          <div className="pt-modern-decision-actions">
            <button
              className="danger"
              type="button"
              onClick={() => setState('confirming')}
            >
              Confirm reset
            </button>
          </div>
        )}
        {state === 'confirming' && (
          <div className="pt-modern-decision-actions" role="group" aria-label="Confirm external runtime reset">
            <button type="button" onClick={() => setState('resume-unavailable')}>Cancel</button>
            <button className="danger" type="button" onClick={() => setState('ready')}>Reset runtime</button>
          </div>
        )}
        {state === 'ready' && (
          <div className="pt-modern-result">
            <span>Old session and runtime home cleaned exactly once.</span>
            <button className="primary" type="button" onClick={() => setState('fresh-session')}>Send next turn</button>
          </div>
        )}
        {state === 'fresh-session' && (
          <div className="pt-modern-result">
            <span>Conversation history preserved. New runtime state is isolated.</span>
            <button type="button" onClick={() => setState('resume-unavailable')}>Reset review state</button>
          </div>
        )}
      </article>
    </div>
  );
}

function BranchScenario() {
  const [branches, setBranches] = useState(['Original response']);
  const [active, setActive] = useState(0);

  const regenerate = () => {
    setBranches((current) => current.length > 1 ? current : [...current, 'Regenerated response']);
    setActive(1);
  };

  return (
    <div className="pt-modern-flow">
      <StateHeading title="Immutable revision" state={`${active + 1}/${branches.length}`} description="Regenerate creates a sibling branch; the source response remains available." />
      <Message role="You" meta="source message">Compare Station-owned and device-owned Agent runtimes.</Message>
      <Message role="Research Agent" meta={`branch ${active + 1} - independent feedback and usage`}>{branches[active]}</Message>
      <div className="pt-modern-branch-actions">
        <button type="button" onClick={() => setActive((value) => Math.max(0, value - 1))}>Previous branch</button>
        <button className="primary" type="button" onClick={regenerate}>Regenerate</button>
        <button type="button" onClick={() => setActive((value) => Math.min(branches.length - 1, value + 1))}>Next branch</button>
      </div>
    </div>
  );
}

function CapabilityScenario() {
  const [mode, setMode] = useState<'blocked' | 'degraded'>('blocked');

  return (
    <div className="pt-modern-flow">
      <StateHeading title="Capability resolution" state={mode} description="Unsupported work is disclosed before provider or tool execution." />
      <article className={`pt-modern-capability is-${mode}`}>
        <div>
          <span className="pt-modern-eyebrow">Authority: Station runtime capability snapshot</span>
          <strong>{mode === 'blocked' ? 'Image input is unavailable' : 'Reasoning detail is reduced'}</strong>
          <p>{mode === 'blocked' ? 'The selected text-only model cannot consume architecture.png.' : 'The model provides reasoning status and duration, but not private reasoning text.'}</p>
        </div>
        <div>
          <button type="button" onClick={() => setMode('blocked')}>Review blocked input</button>
          <button type="button" onClick={() => setMode('degraded')}>Review degraded reasoning</button>
        </div>
        <small>{mode === 'blocked' ? 'No provider request has been sent.' : 'You may continue with the disclosed reduced experience.'}</small>
      </article>
    </div>
  );
}

function DiagnosticsScenario() {
  const [feedback, setFeedback] = useState<'none' | 'up' | 'down'>('none');
  const [exported, setExported] = useState(false);

  return (
    <div className="pt-modern-flow">
      <StateHeading title="Usage and diagnostics" state="turn turn-1042" description="Evidence stays attached to the immutable turn and active branch." />
      <div className="pt-modern-diagnostics">
        <section><strong>Usage</strong><dl><dt>Input</dt><dd>1,248 tokens</dd><dt>Output</dt><dd>386 tokens</dd><dt>Tools</dt><dd>1 call / 1.4s</dd><dt>Cost</dt><dd>Provider estimate: $0.012</dd></dl></section>
        <section><strong>Context sources</strong><ul><li>Memory mem-12 - communication preference</li><li>Skill skill-architecture-review@3</li><li>Knowledge chunk kb-7/chunk-22</li></ul></section>
        <section><strong>Runtime</strong><dl><dt>Provider/model</dt><dd>OpenAI / gpt-4.1</dd><dt>Terminal reason</dt><dd>completed</dd><dt>Trace</dt><dd>trace-8841</dd></dl></section>
      </div>
      <div className="pt-modern-diagnostic-actions">
        <span>Was this answer useful?</span>
        <button className={feedback === 'up' ? 'is-active' : ''} type="button" onClick={() => setFeedback('up')}>Useful</button>
        <button className={feedback === 'down' ? 'is-active' : ''} type="button" onClick={() => setFeedback('down')}>Needs work</button>
        <button type="button" onClick={() => setExported(true)}>{exported ? 'Export ready' : 'Export redacted diagnostics'}</button>
      </div>
    </div>
  );
}

function StateHeading({ title, state, description }: { title: string; state: string; description: string }) {
  return (
    <header className="pt-modern-state-heading">
      <div><strong>{title}</strong><p>{description}</p></div>
      <span>{state}</span>
    </header>
  );
}

function Message({ role, meta, children }: { role: string; meta: string; children: ReactNode }) {
  return (
    <article className={`pt-modern-message ${role === 'You' ? 'is-user' : 'is-agent'}`}>
      <div><strong>{role}</strong><small>{meta}</small></div>
      <p>{children}</p>
    </article>
  );
}
