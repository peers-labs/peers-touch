import { useState } from 'react';
import { Check, CheckCheck, Monitor, Smartphone } from 'lucide-react';

type MultiDeviceScenario = 'multi-device-companion' | 'multi-device-read-cursor';

interface MiniMessage {
  id: string;
  text: string;
  mine: boolean;
  time: string;
  read: boolean;
}

const baseMessages: MiniMessage[] = [
  { id: 'evt-001', text: 'Hey, are we meeting today?', mine: false, time: '10:30', read: true },
  { id: 'evt-002', text: 'Yes, 3pm works for me', mine: true, time: '10:32', read: true },
  { id: 'evt-003', text: 'Perfect, see you then!', mine: false, time: '10:33', read: true },
];

const companionNewMessage: MiniMessage = {
  id: 'evt-004',
  text: 'Actually, can we push to 3:30?',
  mine: true,
  time: '10:41',
  read: false,
};

const unreadMessages: MiniMessage[] = [
  { id: 'evt-004', text: 'Hey, quick question', mine: false, time: '14:10', read: false },
  { id: 'evt-005', text: 'Can you review the PR?', mine: false, time: '14:12', read: false },
  { id: 'evt-006', text: 'Thanks in advance!', mine: false, time: '14:13', read: false },
];

function MiniDeviceFrame({ label, icon: Icon, children }: {
  label: string;
  icon: typeof Monitor;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 11, fontWeight: 600, color: '#6b7080',
      }}>
        <Icon size={13} />
        {label}
      </div>
      <div style={{
        width: 160, height: 280, borderRadius: 16,
        border: '2px solid #e5e7eb', backgroundColor: '#ffffff',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {children}
      </div>
    </div>
  );
}

function MiniHeader({ name, unread }: { name: string; unread: number }) {
  return (
    <div style={{
      padding: '8px 10px', borderBottom: '1px solid #f0f1f4',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#1f2330' }}>{name}</span>
      {unread > 0 && (
        <span style={{
          minWidth: 18, height: 18, borderRadius: 9,
          backgroundColor: '#ef4444', color: '#fff',
          fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 5px',
        }}>
          {unread}
        </span>
      )}
    </div>
  );
}

function MiniMessageBubble({ msg, highlight }: { msg: MiniMessage; highlight?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: msg.mine ? 'flex-end' : 'flex-start',
      animation: highlight ? 'mdFadeIn 0.4s ease-out' : undefined,
    }}>
      <div style={{
        maxWidth: '85%', padding: '4px 7px', borderRadius: 8,
        fontSize: 10, lineHeight: 1.4,
        color: msg.mine ? '#fff' : '#1f2330',
        backgroundColor: msg.mine ? '#6366f1' : '#f0f1f4',
        border: highlight ? '1px solid #6366f1' : 'none',
      }}>
        <div>{msg.text}</div>
        <div style={{
          marginTop: 2, fontSize: 8,
          display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'flex-end',
          color: msg.mine ? 'rgba(255,255,255,0.7)' : '#9ca0ab',
        }}>
          {msg.time}
          {msg.mine && (msg.read ? <CheckCheck size={9} /> : <Check size={9} />)}
        </div>
      </div>
    </div>
  );
}

function SimButton({ text, onClick, disabled }: { text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      type="button"
      style={{
        fontSize: 11, color: disabled ? '#d1d4db' : '#6b7080',
        cursor: disabled ? 'default' : 'pointer',
        padding: '4px 10px', borderRadius: 14,
        border: `1px dashed ${disabled ? '#e4e6eb' : '#d1d4db'}`,
        backgroundColor: 'transparent',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </button>
  );
}

function CompanionDemo() {
  const [projected, setProjected] = useState(false);
  const [delivered, setDelivered] = useState(false);

  const deviceAMessages = [...baseMessages, { ...companionNewMessage, read: delivered }];

  return (
    <>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <MiniDeviceFrame label="Device A (Desktop)" icon={Monitor}>
          <MiniHeader name="Sarah Jenkins" unread={0} />
          <div style={{ flex: 1, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', backgroundColor: '#f7f8fa' }}>
            {deviceAMessages.map((m) => (
              <MiniMessageBubble key={m.id} msg={m} />
            ))}
          </div>
          <div style={{ padding: '6px 8px', borderTop: '1px solid #f0f1f4', display: 'flex', justifyContent: 'center' }}>
            <SimButton
              text={delivered ? 'delivered' : '▶ delivered'}
              onClick={() => setDelivered(true)}
              disabled={delivered}
            />
          </div>
        </MiniDeviceFrame>

        <MiniDeviceFrame label="Device B (Mobile)" icon={Smartphone}>
          <MiniHeader name="Sarah Jenkins" unread={0} />
          <div style={{ flex: 1, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', backgroundColor: '#f7f8fa' }}>
            {baseMessages.map((m) => (
              <MiniMessageBubble key={m.id} msg={m} />
            ))}
            {projected && (
              <MiniMessageBubble msg={{ ...companionNewMessage, read: delivered }} highlight />
            )}
          </div>
          <div style={{ padding: '6px 8px', borderTop: '1px solid #f0f1f4', display: 'flex', justifyContent: 'center' }}>
            <SimButton
              text={projected ? 'projected' : '▶ projection arrives'}
              onClick={() => setProjected(true)}
              disabled={projected}
            />
          </div>
        </MiniDeviceFrame>
      </div>

      <div style={{
        marginTop: 10, padding: '8px 12px', borderRadius: 8,
        backgroundColor: '#f7f8fa', border: '1px solid #e4e6eb',
        fontSize: 11, color: '#6b7080', lineHeight: 1.5, textAlign: 'center',
      }}>
        §11.1 Sender Companion Projection — event_id: <code style={{ fontSize: 10, color: '#6366f1' }}>evt-004</code>
        <br />
        Message sent on Device A appears on Device B via <code style={{ fontSize: 10 }}>upsert(event_id)</code>, not page refresh.
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
        <SimButton text="↺ reset" onClick={() => { setProjected(false); setDelivered(false); }} />
      </div>
    </>
  );
}

function ReadCursorDemo() {
  const [deviceARead, setDeviceARead] = useState(false);
  const [deviceBConverged, setDeviceBConverged] = useState(false);

  const allMessages: MiniMessage[] = [
    ...baseMessages,
    ...unreadMessages.map((m) => ({ ...m, read: false })),
  ];

  const deviceAUnread = deviceARead ? 0 : 3;
  const deviceBUnread = deviceBConverged ? 0 : 3;

  return (
    <>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <MiniDeviceFrame label="Device A (Desktop)" icon={Monitor}>
          <MiniHeader name="Sarah Jenkins" unread={deviceAUnread} />
          <div style={{ flex: 1, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', backgroundColor: '#f7f8fa' }}>
            {allMessages.map((m) => (
              <MiniMessageBubble key={m.id} msg={m} />
            ))}
          </div>
          <div style={{ padding: '6px 8px', borderTop: '1px solid #f0f1f4', display: 'flex', justifyContent: 'center' }}>
            <SimButton
              text={deviceARead ? 'read ✓' : '▶ read messages'}
              onClick={() => setDeviceARead(true)}
              disabled={deviceARead}
            />
          </div>
        </MiniDeviceFrame>

        <MiniDeviceFrame label="Device B (Mobile)" icon={Smartphone}>
          <MiniHeader name="Sarah Jenkins" unread={deviceBUnread} />
          <div style={{ flex: 1, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', backgroundColor: '#f7f8fa' }}>
            {allMessages.map((m) => (
              <MiniMessageBubble key={m.id} msg={m} />
            ))}
          </div>
          <div style={{ padding: '6px 8px', borderTop: '1px solid #f0f1f4', display: 'flex', justifyContent: 'center' }}>
            <SimButton
              text={deviceBConverged ? 'converged ✓' : '▶ cursor converges'}
              onClick={() => setDeviceBConverged(true)}
              disabled={!deviceARead || deviceBConverged}
            />
          </div>
        </MiniDeviceFrame>
      </div>

      <div style={{
        marginTop: 10, padding: '8px 12px', borderRadius: 8,
        backgroundColor: '#f7f8fa', border: '1px solid #e4e6eb',
        fontSize: 11, color: '#6b7080', lineHeight: 1.5, textAlign: 'center',
      }}>
        §11.2 Read Cursor Convergence — monotonically non-decreasing.
        <br />
        Read cursor advanced on Device A → Device B converges without manual interaction.
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
        <SimButton text="↺ reset" onClick={() => { setDeviceARead(false); setDeviceBConverged(false); }} />
      </div>
    </>
  );
}

export function MultiDeviceDemo({ scenario }: { scenario: MultiDeviceScenario }) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      padding: 12, gap: 8, overflowY: 'auto',
      backgroundColor: '#f7f8fa',
    }}>
      <style>{`@keyframes mdFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div style={{
        fontSize: 14, fontWeight: 700, color: '#1f2330', textAlign: 'center',
        padding: '4px 0',
      }}>
        {scenario === 'multi-device-companion'
          ? 'Sender Companion Projection'
          : 'Read Cursor Convergence'}
      </div>
      {scenario === 'multi-device-companion' ? <CompanionDemo /> : <ReadCursorDemo />}
    </div>
  );
}
