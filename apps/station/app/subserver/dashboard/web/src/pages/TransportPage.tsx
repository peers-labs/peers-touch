/**
 * TransportPage — Station-side transport observability.
 *
 * History: this page used to mirror the in-memory state of the
 * `signaling` subserver (peer registry, ICE sessions, offers,
 * answers, candidates) so that operators could debug why a WebRTC
 * pair never reached `connected`. After 8.3c the entire signaling
 * subserver and its `/api/v1/ice/{peer,session}/...` surface are
 * gone — every offer / answer / ICE candidate now flows through the
 * realtime SSE plane (`POST /realtime/signal` + `GET /events/stream`)
 * and Station treats those payloads as opaque ciphertext, so there is
 * nothing meaningful to mirror in a dashboard table anyway.
 *
 * What remains is the part of "transport" that Station legitimately
 * still owns: friend-chat persistence counters (sessions, messages,
 * outbox depth, attachment count). A small "Realtime stream" panel
 * documents the current architecture so operators stop looking for
 * the old ICE tables.
 *
 * Two follow-ups are tracked but intentionally NOT shipped here to
 * keep this commit a pure removal:
 *   - EventBus stats endpoint on the events subserver (subscriber
 *     count, ring buffer depth, dropped-event counter). When that
 *     ships, populate the "Realtime stream" card with live numbers.
 *   - Per-actor presence snapshot pulled from PresenceSupervisor.
 */

import { useEffect, useMemo, useState } from 'react';
import { Card, Typography, Spin, Tag } from 'antd';
import { Flexbox } from 'react-layout-kit';
import PageHeader from '../components/PageHeader';
import { log } from '../utils/logger';
import * as friendChatDebugApi from '../api/friendChatDebug';

const { Text, Paragraph } = Typography;

export default function TransportPage() {
  const [loading, setLoading] = useState(false);
  const [friendStats, setFriendStats] = useState<friendChatDebugApi.FriendChatStats | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const fstats = await friendChatDebugApi.getFriendChatStats().catch((err) => {
        log.warn('transport', 'Friend chat stats unavailable', { error: String(err) });
        return null;
      });
      setFriendStats(fstats);
    } catch (err) {
      log.error('transport', 'Failed to load transport data', { error: String(err) });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAll().catch(() => {});
    const timer = window.setInterval(() => {
      loadAll().catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const realtimeNote = useMemo(() => (
    <Paragraph style={{ marginBottom: 0 }}>
      Offer / answer / ICE candidates are exchanged on the realtime SSE
      plane (<Text code>POST /realtime/signal</Text> →
      {' '}<Text code>GET /events/stream</Text>) using a per-message
      sealed envelope (X25519 + AES-256-GCM). Station never decrypts
      the payload, so there is nothing to render here for live calls.
      For per-call introspection, look at the desktop client's
      developer console.
    </Paragraph>
  ), []);

  return (
    <Flexbox gap={0}>
      <PageHeader
        title="Transport"
        subtitle="Realtime stream + friend chat persistence"
      />

      <Flexbox style={{ padding: 24 }} gap={16}>
        <Card title="Realtime stream" extra={<Tag color="blue">SSE</Tag>}>
          {realtimeNote}
        </Card>

        <Card title="Friend Chat persistence" extra={loading ? <Spin size="small" /> : null}>
          {friendStats ? (
            <Flexbox gap={6}>
              <Text>sessions: <Text code>{friendStats.sessions}</Text></Text>
              <Text>messages: <Text code>{friendStats.messages}</Text></Text>
              <Text>friend requests: <Text code>{friendStats.friend_requests}</Text></Text>
              <Text>outbox: <Text code>{friendStats.outbox}</Text></Text>
              <Text>attachments: <Text code>{friendStats.attachments}</Text></Text>
            </Flexbox>
          ) : (
            <Text type="secondary">Requires dashboard login</Text>
          )}
        </Card>
      </Flexbox>
    </Flexbox>
  );
}
