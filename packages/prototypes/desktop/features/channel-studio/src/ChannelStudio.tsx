/**
 * Channel Studio — M1+M2 product-behavior review prototype.
 *
 * Pure front-end mock (no Station / no lark-cli execution), but every state and
 * transition is modeled on the verified lark-cli contract and the Station
 * channel-host design:
 *
 *   inbound : `lark-cli event consume im.message.receive_v1` emits NDJSON
 *             { message_id, chat_type:p2p|group, sender_id, content, mentions }
 *             — message_id is the idempotency key.
 *   outbound: `lark-cli im +messages-send --chat-id ... --idempotency-key ...`
 *
 * Left  = peers Desktop: channel plugin import/lint/enable, Agent binding,
 *         Provider readiness, live event bus status.
 * Right = Lark DM client: send a message → Agent turn → bot reply, with
 *         reconnect / unbound / provider-not-ready / duplicate-delivery cases.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  CloudOff,
  Loader2,
  MessageCircle,
  Package,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Square,
  Terminal,
  TriangleAlert,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { T } from '../../../shell/src/theme';

type PluginStatus = 'registered' | 'connecting' | 'online' | 'failed';
type ProviderKind = 'direct' | 'codex' | 'traex';
type TurnPhase = 'idle' | 'received' | 'thinking' | 'tools' | 'replying' | 'blocked';

interface ProviderInfo {
  kind: ProviderKind;
  label: string;
  ready: boolean;
  note: string;
}

interface ChatMsg {
  id: string;
  side: 'user' | 'bot' | 'system';
  text: string;
  phase?: TurnPhase;
  mid?: string; // lark om_ id for bot/user messages
}

interface EventLogLine {
  id: number;
  kind: 'event' | 'send' | 'dedup' | 'sys';
  text: string;
}

const PROVIDERS: ProviderInfo[] = [
  { kind: 'direct', label: 'Direct Model', ready: true, note: '云端模型直连 · 就绪' },
  { kind: 'codex', label: 'codex (CLI)', ready: true, note: 'codex-cli · 已登录' },
  { kind: 'traex', label: 'traex (CLI)', ready: false, note: 'trae-cli · 未登录' },
];

const AGENTS = ['Travel Assistant', 'Terminal', 'Oncall Master'];

const CAPABILITIES = ['messaging.receive', 'messaging.longconn', 'messaging.send'];

let logSeq = 1;
let msgSeq = 1;

export function ChannelStudio() {
  // plugin lifecycle
  const [installed, setInstalled] = useState(false);
  const [status, setStatus] = useState<PluginStatus>('registered');
  const [showImport, setShowImport] = useState(false);
  const [lintStep, setLintStep] = useState(0);

  // configuration
  const [boundAgent, setBoundAgent] = useState(AGENTS[0]);
  const [provider, setProvider] = useState<ProviderKind>('direct');
  const [connection, setConnection] = useState<'up' | 'down'>('up');
  const [crashEnabled, setCrashEnabled] = useState(false);

  // chat
  const [messages, setMessages] = useState<ChatMsg[]>([
    { id: 'seed', side: 'system', text: '这是你与机器人的私聊（p2p）。启用插件并绑定 Agent 后即可对话。' },
  ]);
  const [input, setInput] = useState('');
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<EventLogLine[]>([]);
  const [phase, setPhase] = useState<TurnPhase>('idle');
  const timers = useRef<number[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, phase]);

  const addLog = (kind: EventLogLine['kind'], text: string) =>
    setLog((l) => [...l.slice(-40), { id: logSeq++, kind, text }]);

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  };

  // ---- import / lint / enable -------------------------------------------------
  const runImport = () => {
    setShowImport(true);
    setLintStep(0);
    later(() => setLintStep(1), 500);
    later(() => setLintStep(2), 1100);
    later(() => setLintStep(3), 1700);
    later(() => {
      setShowImport(false);
      setInstalled(true);
      setStatus('registered');
      addLog('sys', '插件包安装完成：lark@0.1.0（默认未启用）');
    }, 2300);
  };

  const enable = () => {
    if (status === 'online' || status === 'connecting') {
      // disable
      setStatus('registered');
      setConnection('down');
      addLog('sys', '插件已停用，event bus 断开');
      return;
    }
    setStatus('connecting');
    setConnection('down');
    addLog('sys', '启动插件进程并拉起 lark-cli event consume …');
    later(() => {
      setStatus('online');
      setConnection('up');
      addLog('event', 'event bus daemon 在线：im.message.receive_v1 已订阅');
    }, 1400);
  };

  const toggleConnection = () => {
    if (status !== 'online') return;
    if (connection === 'up') {
      setConnection('down');
      addLog('sys', '网络中断：event consume 流断开（等待自动重连）');
      later(() => {
        setConnection('up');
        addLog('sys', 'event bus 自动重连成功，断点事件已补发');
      }, 2600);
    } else {
      setConnection('up');
    }
  };

  // ---- inbound turn -----------------------------------------------------------
  const canRun = installed && status === 'online' && connection === 'up';
  const selectedProvider = PROVIDERS.find((p) => p.kind === provider)!;

  const pushSystem = (text: string) =>
    setMessages((m) => [...m, { id: `sys${msgSeq++}`, side: 'system', text }]);

  const receiveInbound = (rawText: string, opts: { duplicateOf?: string } = {}) => {
    const messageId = opts.duplicateOf ?? `om_${Math.abs(hash(rawText + msgSeq)).toString(16)}`;

    // hard gates
    if (!installed || status !== 'online') {
      addLog('sys', '丢弃事件：插件未启用');
      return;
    }
    if (connection === 'down') {
      addLog('sys', '连接中断：事件暂存于 event bus，恢复后补发');
      return;
    }
    if (seenIds.has(messageId)) {
      addLog('dedup', `重复投递忽略：${messageId}（message_id 幂等）`);
      return;
    }
    setSeenIds((s) => new Set(s).add(messageId));
    addLog('event', `← im.message.receive_v1  ${messageId}  chat_type=p2p`);

    // provider readiness gate
    if (!selectedProvider.ready) {
      setPhase('blocked');
      setMessages((m) => [
        ...m,
        { id: `u${msgSeq++}`, side: 'user', text: rawText, mid: messageId },
      ]);
      pushSystem(`Provider 未就绪：${selectedProvider.label}（${selectedProvider.note}）。请在设置中登录或切换。`);
      later(() => setPhase('idle'), 400);
      return;
    }

    setPhase('received');
    setMessages((m) => [
      ...m,
      { id: `u${msgSeq++}`, side: 'user', text: rawText, mid: messageId },
    ]);
    later(() => setPhase('thinking'), 500);
    later(() => setPhase('tools'), 1200);
    later(() => {
      setPhase('replying');
      const reply = craftReply(rawText, boundAgent, selectedProvider.label);
      const botMid = `om_${Math.abs(hash(reply + msgSeq)).toString(16)}`;
      addLog('send', `→ im +messages-send  --chat-id oc_demo --idempotency-key ${botMid}`);
      setMessages((m) => [...m, { id: `b${msgSeq++}`, side: 'bot', text: reply, mid: botMid }]);
      later(() => setPhase('idle'), 300);
    }, 2100);
  };

  const sendUser = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    receiveInbound(text);
  };

  const simulateDuplicate = () => {
    // replay the last user message with the SAME message_id
    const lastUser = [...messages].reverse().find((m) => m.side === 'user');
    if (!lastUser?.mid) {
      pushSystem('先发一条消息，再模拟重复投递。');
      return;
    }
    receiveInbound(lastUser.text, { duplicateOf: lastUser.mid });
  };

  const statusMeta: Record<PluginStatus, { label: string; color: string; icon: typeof Wifi }> = {
    registered: { label: '未启用', color: T.textTertiary, icon: Square },
    connecting: { label: '连接中', color: T.warning, icon: Loader2 },
    online: { label: '在线', color: T.success, icon: Wifi },
    failed: { label: '异常', color: T.danger, icon: TriangleAlert },
  };
  const sm = statusMeta[status];

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: T.surface }}>
      {/* top bar */}
      <div style={topBarStyle}>
        <button type="button" onClick={() => window.history.replaceState({}, '', window.location.pathname) || window.location.reload()} style={ghostBtnStyle}>
          <ArrowLeft size={16} /> 返回
        </button>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>Channel Studio</div>
        <div style={{ fontSize: 12, color: T.textTertiary }}>M1 插件能装能连 · M2 Lark 私聊闭环（产品行为对齐，非真实调用）</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'auto' }}>
        <div style={{ height: '100%', minWidth: 920, display: 'grid', gridTemplateColumns: '300px minmax(360px,1fr) 260px', gap: 12, padding: 12 }}>
        {/* ── LEFT: Desktop channel management ── */}
        <div style={panelStyle}>
          <PanelTitle icon={Plug} title="通道插件" subtitle="Station 动态插件 · 导入即用" />

          {!installed ? (
            <button type="button" onClick={runImport} style={importBtnStyle}>
              <Plus size={18} />
              导入通道插件
            </button>
          ) : (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={chipStyle(T.primary)}><Bot size={18} color={T.white} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Lark</div>
                  <div style={{ fontSize: 12, color: T.textTertiary }}>lark@0.1.0 · lark-cli 适配</div>
                </div>
                <span style={{ ...statusPill, color: sm.color }}>
                  <sm.icon size={13} className={status === 'connecting' ? 'spin' : ''} /> {sm.label}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {CAPABILITIES.map((c) => (
                  <span key={c} style={capTag}>{c}</span>
                ))}
              </div>
              <button type="button" onClick={enable} style={{ ...enableBtn, background: status === 'online' ? T.fillQuaternary : T.primary, color: status === 'online' ? T.textSecondary : T.white }}>
                {status === 'online' ? <Square size={14} /> : <Zap size={14} />}
                {status === 'online' ? '停用' : status === 'connecting' ? '连接中…' : '启用并连接'}
              </button>
            </div>
          )}

          {installed && (
            <>
              <Field label="绑定 Agent（私聊默认路由）">
                <select value={boundAgent} onChange={(e) => setBoundAgent(e.target.value)} style={selectStyle}>
                  {AGENTS.map((a) => <option key={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="Provider / Runtime">
                <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderKind)} style={selectStyle}>
                  {PROVIDERS.map((p) => <option key={p.kind}>{p.label}</option>)}
                </select>
                <div style={{ marginTop: 6, fontSize: 12, color: selectedProvider.ready ? T.success : T.warning }}>
                  ● {selectedProvider.note}
                </div>
              </Field>
            </>
          )}

          <div style={{ marginTop: 'auto', paddingTop: 12, display: 'grid', gap: 8 }}>
            <ScenarioButton disabled={!canRun} onClick={toggleConnection} icon={connection === 'up' ? WifiOff : Wifi}>
              {connection === 'up' ? '模拟断网（自动重连）' : '立即重连'}
            </ScenarioButton>
            <ScenarioButton disabled={!canRun} onClick={simulateDuplicate} icon={RefreshCw}>
              重复投递同一事件（验幂等）
            </ScenarioButton>
            <ScenarioButton onClick={() => setCrashEnabled((v) => !v)} icon={CloudOff} active={crashEnabled} disabled={!installed}>
              {crashEnabled ? '取消插件崩溃' : '模拟插件进程崩溃'}
            </ScenarioButton>
          </div>
        </div>

        {/* ── CENTER: Lark DM client ── */}
        <div style={{ ...panelStyle, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* lark header */}
          <div style={larkHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ ...chipStyle('#3370ff'), width: 36, height: 36 }}><Bot size={18} color="#fff" /></div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{boundAgent} · 机器人</div>
                <div style={{ fontSize: 12, color: connection === 'up' ? T.success : T.danger, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {connection === 'up' ? <Wifi size={12} /> : <WifiOff size={12} />}
                  {status === 'online' ? (connection === 'up' ? 'event 长连在线' : '连接中断，重连中…') : '机器人离线'}
                </div>
              </div>
            </div>
          </div>

          {crashEnabled && installed && (
            <div style={crashBanner}>
              <TriangleAlert size={14} /> 插件进程已退出（kill -9）→ Station 标记 failed
              <button type="button" onClick={() => { setCrashEnabled(false); enable(); }} style={{ marginLeft: 'auto', ...miniBtn }}>
                <RefreshCw size={12} /> 重启插件
              </button>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, background: '#f5f6f8' }}>
            {messages.map((m) =>
              m.side === 'system' ? (
                <div key={m.id} style={sysMsg}>{m.text}</div>
              ) : (
                <div key={m.id} style={{ display: 'flex', justifyContent: m.side === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={m.side === 'user' ? userBubble : botBubble}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                    {m.mid && <div style={midStyle}>{m.mid}</div>}
                  </div>
                </div>
              ),
            )}
            {(phase === 'thinking' || phase === 'tools' || phase === 'received') && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ ...botBubble, display: 'flex', alignItems: 'center', gap: 8, color: T.textTertiary, fontSize: 12 }}>
                  <Loader2 size={14} className="spin" />
                  {phase === 'received' ? '已接收，排队…' : phase === 'thinking' ? `Agent「${boundAgent}」思考中` : '调用工具中…'}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={composerStyle}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendUser()}
              placeholder={canRun ? '给机器人发消息…' : '请先在左侧导入并启用插件'}
              disabled={!canRun || crashEnabled}
              style={composerInput}
            />
            <button type="button" onClick={sendUser} disabled={!canRun || crashEnabled} style={{ ...sendBtn, opacity: canRun && !crashEnabled ? 1 : 0.5 }}>
              发送
            </button>
          </div>
        </div>

        {/* ── RIGHT: event bus log ── */}
        <div style={panelStyle}>
          <PanelTitle icon={Terminal} title="Event Bus / CLI" subtitle="lark-cli 真实命令对照" />
          <div style={cliBox}>
            <div style={cliLine}><span style={{ color: T.textTertiary }}>$</span> lark-cli event consume im.message.receive_v1</div>
            <div style={{ ...cliLine, color: connection === 'up' ? T.success : T.danger }}>
              {status === 'online' ? (connection === 'up' ? '● streaming NDJSON …' : '○ stream interrupted') : '○ not running'}
            </div>
          </div>
          <div style={{ ...cliBox, minHeight: 200, maxHeight: 'none', flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {log.length === 0 && <div style={{ color: T.textQuaternary, fontSize: 12 }}>事件日志将出现在这里</div>}
            {log.map((l) => (
              <div key={l.id} style={{ fontSize: 11, lineHeight: 1.5, color: logColor(l.kind), wordBreak: 'break-all' }}>
                {logPrefix(l.kind)}{l.text}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11, color: T.textTertiary }}>
            <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 1 }} color={T.success} />
            凭据由 lark-cli 外部注入，插件与 Station 均不保存 Lark 密钥。
          </div>
        </div>
        </div>
      </div>

      {showImport && <ImportOverlay step={lintStep} onClose={() => setShowImport(false)} />}
      <style>{spinCss}</style>
    </div>
  );
}

// ── import overlay ──────────────────────────────────────────────────────────
function ImportOverlay({ step, onClose }: { step: number; onClose: () => void }) {
  const checks = [
    '解析 plugin.json（schema v1）',
    '校验平台 entry 与可执行位',
    '能力白名单：messaging.* 审核',
    '路径逃逸 / zip-slip 安全扫描',
  ];
  return (
    <div style={overlayBg}>
      <div style={overlayCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Package size={18} color={T.primary} />
          <b style={{ color: T.text }}>导入通道插件</b>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', border: 0, background: 'transparent', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        {checks.map((c, i) => {
          const done = step > i;
          const active = step === i;
          return (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13, color: done ? T.text : active ? T.text : T.textTertiary }}>
              {done ? <CheckCircle2 size={16} color={T.success} /> : active ? <Loader2 size={16} className="spin" color={T.primary} /> : <span style={{ width: 16, height: 16, borderRadius: '50%', border: `1px solid ${T.border}` }} />}
              {c}
            </div>
          );
        })}
        <div style={{ marginTop: 12, fontSize: 12, color: T.textTertiary }}>安装即信 + 强制 lint（方案 A）。安装后默认不启用，不自动启动进程。</div>
      </div>
    </div>
  );
}

// ── helpers/styles ───────────────────────────────────────────────────────────
const spinCss = `.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`;

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); } return h; }
function craftReply(text: string, agent: string, prov: string) {
  return `[${agent} · ${prov}] 已收到：「${text}」\n（原型占位：正式版此处为 Agent turn 的真实回复，经 im +messages-send 幂等投递）`;
}
function logColor(k: EventLogLine['kind']) { return k === 'event' ? T.text : k === 'send' ? T.primary : k === 'dedup' ? T.warning : T.textTertiary; }
function logPrefix(k: EventLogLine['kind']) { return k === 'event' ? '' : k === 'send' ? '' : k === 'dedup' ? '⚠ ' : '· '; }

function PanelTitle({ icon: Icon, title, subtitle }: { icon: typeof Bot; title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: T.text }}>
        <Icon size={16} color={T.primary} /> {title}
      </div>
      <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2 }}>{subtitle}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}
function ScenarioButton({ children, icon: Icon, onClick, disabled, active }: { children: React.ReactNode; icon: typeof Bot; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 10px', borderRadius: 8, border: `1px solid ${active ? T.primary : T.borderSoft}`, background: active ? T.primaryWash : T.bg, color: disabled ? T.textQuaternary : T.textSecondary, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', width: '100%' }}>
      <Icon size={14} /> {children}
    </button>
  );
}

const topBarStyle: React.CSSProperties = { height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', borderBottom: `1px solid ${T.border}`, background: T.bg };
const ghostBtnStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: T.textSecondary, fontSize: 13, cursor: 'pointer' };
const panelStyle: React.CSSProperties = { background: T.bg, border: `1px solid ${T.borderSoft}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' };
const importBtnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 10, border: `1px dashed ${T.primary}`, background: T.primaryWash, color: T.primary, fontSize: 14, fontWeight: 700, cursor: 'pointer' };
const cardStyle: React.CSSProperties = { border: `1px solid ${T.borderSoft}`, borderRadius: 10, padding: 12, background: T.surface };
const chipStyle = (bg: string): React.CSSProperties => ({ width: 38, height: 38, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 });
const statusPill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700 };
const capTag: React.CSSProperties = { fontSize: 11, lineHeight: '20px', padding: '0 8px', borderRadius: 6, background: T.fillQuaternary, color: T.textSecondary, border: `1px solid ${T.borderSoft}` };
const enableBtn: React.CSSProperties = { marginTop: 12, width: '100%', height: 36, borderRadius: 8, border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const selectStyle: React.CSSProperties = { width: '100%', height: 36, borderRadius: 8, border: `1px solid ${T.border}`, padding: '0 10px', fontSize: 13, color: T.text, background: T.bg };
const larkHeader: React.CSSProperties = { padding: '12px 16px', borderBottom: `1px solid ${T.borderSoft}`, background: T.bg };
const crashBanner: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#fff2f0', color: T.danger, fontSize: 12, borderBottom: `1px solid ${T.borderSoft}` };
const miniBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 8px', borderRadius: 6, border: `1px solid ${T.danger}`, background: T.bg, color: T.danger, fontSize: 11, cursor: 'pointer' };
const sysMsg: React.CSSProperties = { alignSelf: 'center', fontSize: 12, color: T.textTertiary, background: 'rgba(0,0,0,0.04)', padding: '4px 10px', borderRadius: 8, maxWidth: '80%', textAlign: 'center' };
const userBubble: React.CSSProperties = { maxWidth: '72%', background: '#3370ff', color: '#fff', borderRadius: '12px 12px 2px 12px', padding: '10px 12px', fontSize: 13, lineHeight: 1.5 };
const botBubble: React.CSSProperties = { maxWidth: '72%', background: T.bg, color: T.text, border: `1px solid ${T.borderSoft}`, borderRadius: '12px 12px 12px 2px', padding: '10px 12px', fontSize: 13, lineHeight: 1.5 };
const midStyle: React.CSSProperties = { marginTop: 6, fontSize: 10, opacity: 0.65, fontFamily: 'monospace' };
const composerStyle: React.CSSProperties = { display: 'flex', gap: 8, padding: 12, borderTop: `1px solid ${T.borderSoft}`, background: T.bg };
const composerInput: React.CSSProperties = { flex: 1, height: 38, borderRadius: 10, border: `1px solid ${T.border}`, padding: '0 12px', fontSize: 13, outline: 'none' };
const sendBtn: React.CSSProperties = { height: 38, padding: '0 18px', borderRadius: 10, border: 0, background: '#3370ff', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const cliBox: React.CSSProperties = { background: '#0f1115', borderRadius: 8, padding: 10, marginBottom: 8 };
const cliLine: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, color: '#d6deeb', lineHeight: 1.6 };
const overlayBg: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 };
const overlayCard: React.CSSProperties = { width: 380, background: T.bg, borderRadius: 14, padding: 20, boxShadow: '0 16px 48px rgba(0,0,0,0.2)' };

// satisfy import of MessageCircle reserved for future group view; no-op marker.
void MessageCircle;
