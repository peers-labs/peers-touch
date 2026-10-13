import { useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  CircleDot,
  Clock3,
  HardDrive,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import {
  CHAT_JOURNEY,
  CHAT_JOURNEY_COPY,
  CHAT_JOURNEY_ID,
  CHAT_JOURNEY_MESSAGE_ID,
  resolveChatJourneyLocale,
  type ChatDeliveryState,
} from '../../../shared/chat-journey';
import './chatOperations.css';

type DeliveryStage = {
  id: string;
  label: string;
  detail: string;
  icon: typeof Smartphone;
  state: 'complete' | 'attention' | 'pending';
};

export function ChatOperationsPage() {
  const locale = typeof window === 'undefined'
    ? 'en'
    : resolveChatJourneyLocale(window.location.search, window.navigator.language);
  const copy = CHAT_JOURNEY_COPY[locale];
  const [deliveryState, setDeliveryState] = useState<ChatDeliveryState>('failed');
  const [lastAction, setLastAction] = useState(locale === 'zh' ? '等待运维处理' : 'Awaiting operator action');
  const failed = deliveryState === 'failed';
  const recovering = deliveryState === 'recovering';

  const stages: DeliveryStage[] = [
    {
      id: 'device',
      label: copy.localSaved,
      detail: locale === 'zh' ? '密文与发送意图已持久化' : 'Ciphertext and send intent persisted',
      icon: Smartphone,
      state: 'complete',
    },
    {
      id: 'station',
      label: copy.stationAccepted,
      detail: CHAT_JOURNEY.station,
      icon: Server,
      state: 'complete',
    },
    {
      id: 'relay',
      label: deliveryState === 'delivered' ? copy.delivered : copy.relayUnavailable,
      detail: CHAT_JOURNEY.traceId,
      icon: Radio,
      state: deliveryState === 'delivered' ? 'complete' : recovering ? 'pending' : 'attention',
    },
    {
      id: 'remote',
      label: deliveryState === 'delivered' ? copy.remoteAcknowledged : copy.remotePending,
      detail: CHAT_JOURNEY.remoteStation,
      icon: CheckCheck,
      state: deliveryState === 'delivered' ? 'complete' : 'pending',
    },
  ];

  function reconcile() {
    if (!failed) return;
    setDeliveryState('recovering');
    setLastAction(locale === 'zh' ? '正在重新建立中继并查询远端确认' : 'Re-establishing relay and querying remote acknowledgement');
    window.setTimeout(() => {
      setDeliveryState('delivered');
      setLastAction(copy.deliveryRecovered);
    }, 1200);
  }

  return (
    <div className="co-page">
      <header className="co-header">
        <div>
          <span className="co-eyebrow">{CHAT_JOURNEY_ID}</span>
          <h1>{copy.queueTitle}</h1>
          <p>{copy.queueSubtitle}</p>
        </div>
        <div className={`co-summary ${deliveryState}`}>
          {deliveryState === 'delivered' ? <CheckCheck size={18} /> : failed ? <AlertCircle size={18} /> : <RefreshCw size={18} />}
          <span>{deliveryState === 'delivered' ? copy.healthySummary : recovering ? copy.deliveryRecovering : copy.attentionSummary}</span>
        </div>
      </header>

      <section className="co-flow" aria-label={locale === 'zh' ? '消息投递阶段' : 'Message delivery stages'}>
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          return (
            <div className={`co-stage ${stage.state}`} key={stage.id}>
              <div className="co-stage-marker">
                <Icon size={17} />
              </div>
              <div className="co-stage-copy">
                <strong>{stage.label}</strong>
                <span>{stage.detail}</span>
              </div>
              {index < stages.length - 1 ? <div className="co-stage-line" aria-hidden="true" /> : null}
            </div>
          );
        })}
      </section>

      <div className="co-workspace">
        <section className="co-queue" aria-labelledby="co-queue-title">
          <div className="co-section-heading">
            <div>
              <span>{locale === 'zh' ? '待处理队列' : 'Attention queue'}</span>
              <h2 id="co-queue-title">{copy.journeyName}</h2>
            </div>
            <span className={`co-state-label ${deliveryState}`}>
              {deliveryState === 'delivered' ? copy.delivered : recovering ? copy.retrying : copy.deliveryFailed}
            </span>
          </div>

          <article className="co-message-row">
            <div className="co-message-actor">AC</div>
            <div className="co-message-body">
              <div className="co-message-meta">
                <strong>Alex Chen</strong>
                <span>{CHAT_JOURNEY.conversationName[locale]}</span>
                <span>{CHAT_JOURNEY.timestamps.outbound}</span>
              </div>
              <p>{CHAT_JOURNEY.messages.outbound[locale]}</p>
              <div className="co-message-foot">
                <span><ShieldCheck size={13} /> {copy.noDataLoss}</span>
                <code>{CHAT_JOURNEY_MESSAGE_ID}</code>
              </div>
            </div>
          </article>

          <div className="co-actions">
            <button type="button" className="co-primary-action" disabled={!failed} onClick={reconcile}>
              <RefreshCw size={15} />
              {recovering ? copy.retrying : deliveryState === 'delivered' ? copy.delivered : copy.runReconciliation}
            </button>
            <button type="button" className="co-secondary-action">
              <HardDrive size={15} />
              {copy.inspectQueue}
            </button>
          </div>
        </section>

        <aside className="co-evidence" aria-labelledby="co-evidence-title">
          <div className="co-section-heading">
            <div>
              <span>{locale === 'zh' ? '对账证据' : 'Reconciliation evidence'}</span>
              <h2 id="co-evidence-title">{locale === 'zh' ? '当前投递事实' : 'Current delivery facts'}</h2>
            </div>
          </div>
          <dl>
            <div>
              <dt>{locale === 'zh' ? '消息 ID' : 'Message ID'}</dt>
              <dd><code>{CHAT_JOURNEY_MESSAGE_ID}</code></dd>
            </div>
            <div>
              <dt>{locale === 'zh' ? '本地持久化' : 'Local persistence'}</dt>
              <dd><Check size={14} /> {locale === 'zh' ? '已确认' : 'Confirmed'}</dd>
            </div>
            <div>
              <dt>{locale === 'zh' ? '重试次数' : 'Retry count'}</dt>
              <dd>{deliveryState === 'delivered' ? '1' : '0'}</dd>
            </div>
            <div>
              <dt>{locale === 'zh' ? '远端确认' : 'Remote acknowledgement'}</dt>
              <dd>{deliveryState === 'delivered' ? <CheckCheck size={14} /> : <Clock3 size={14} />} {deliveryState === 'delivered' ? copy.delivered : copy.remotePending}</dd>
            </div>
          </dl>
          <p className="co-operator-note">{copy.operatorNote}</p>
        </aside>
      </div>

      <footer className="co-event-line" aria-live="polite">
        <CircleDot size={13} />
        <span>{lastAction}</span>
        <code>{CHAT_JOURNEY.traceId}</code>
      </footer>
    </div>
  );
}
