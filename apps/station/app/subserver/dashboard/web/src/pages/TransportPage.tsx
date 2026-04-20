/**
 * TransportPage — Station-side transport observability.
 * Shows ICE signaling health and friend-chat persistence counters.
 */

import { useEffect, useMemo, useState } from 'react';
import { Card, Table, Typography, Tag, Spin, Button, Tooltip, AutoComplete } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import PageHeader from '../components/PageHeader';
import { formatTime } from '../utils/format';
import { log } from '../utils/logger';
import * as iceApi from '../api/ice';
import * as friendChatDebugApi from '../api/friendChatDebug';
import * as actorsApi from '../api/actors';

const { Text } = Typography;

function normalizePair(a: string, b: string): [string, string] {
  return a.localeCompare(b) <= 0 ? [a, b] : [b, a];
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for insecure contexts.
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
}

function roleTag(role: string) {
  if (role.includes('p2p:connected')) return <Tag color="green">Direct</Tag>;
  if (role.includes('p2p:failed')) return <Tag color="default">Fallback</Tag>;
  if (role.includes('p2p:closed')) return <Tag color="default">Closed</Tag>;
  return <Tag>Client</Tag>;
}

export default function TransportPage() {
  const [loading, setLoading] = useState(false);
  const [iceStats, setIceStats] = useState<iceApi.IceStats | null>(null);
  const [icePeers, setIcePeers] = useState<iceApi.IcePeer[]>([]);
  const [iceSessions, setIceSessions] = useState<iceApi.IceSession[]>([]);
  const [friendStats, setFriendStats] = useState<friendChatDebugApi.FriendChatStats | null>(null);

  const [observerA, setObserverA] = useState('');
  const [observerB, setObserverB] = useState('');
  const [actorOptions, setActorOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [pairSessionId, setPairSessionId] = useState<string>('');
  const [pairSession, setPairSession] = useState<iceApi.IceSession | null>(null);
  const [pairOffer, setPairOffer] = useState<iceApi.IceSdpResult | null>(null);
  const [pairAnswer, setPairAnswer] = useState<iceApi.IceSdpResult | null>(null);
  const [pairCandidates, setPairCandidates] = useState<iceApi.IceCandidatesResult | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [stats, peers, sessions, fstats] = await Promise.all([
        iceApi.getIceStats(),
        iceApi.getIcePeers(),
        iceApi.getIceSessions(),
        friendChatDebugApi.getFriendChatStats().catch((err) => {
          // Dashboard auth required. If user not logged in, axios interceptor will redirect.
          log.warn('transport', 'Friend chat stats unavailable', { error: String(err) });
          return null;
        }),
      ]);
      setIceStats(stats);
      setIcePeers(peers);
      setIceSessions(sessions);
      setFriendStats(fstats);
    } catch (err) {
      log.error('transport', 'Failed to load transport data', { error: String(err) });
    }
    setLoading(false);
  };

  const loadPair = async (a: string, b: string) => {
    const aa = a.trim();
    const bb = b.trim();
    if (!aa || !bb) {
      setPairSessionId('');
      setPairSession(null);
      setPairOffer(null);
      setPairAnswer(null);
      setPairCandidates(null);
      return;
    }
    const [x, y] = normalizePair(aa, bb);
    const sid = `${x}-${y}`;
    setPairSessionId(sid);
    try {
      const [sess, offer, answer, candidates] = await Promise.all([
        iceApi.getIceSession(sid),
        iceApi.getIceOffer(sid),
        iceApi.getIceAnswer(sid),
        iceApi.getIceCandidates(sid),
      ]);
      setPairSession(sess);
      setPairOffer(offer);
      setPairAnswer(answer);
      setPairCandidates(candidates);
    } catch (err) {
      log.warn('transport', 'Failed to load pair flow', { error: String(err) });
    }
  };

  useEffect(() => {
    loadAll().catch(() => {});
    const timer = window.setInterval(() => {
      loadAll().catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadPair(observerA, observerB).catch(() => {});
    const timer = window.setInterval(() => {
      loadPair(observerA, observerB).catch(() => {});
    }, 1500);
    return () => window.clearInterval(timer);
  }, [observerA, observerB]);

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;
    const loadOptions = (keyword: string) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          const res = await actorsApi.listActors(1, 20, keyword || '');
          if (disposed) return;
          setActorOptions((res.items || []).map((a) => ({
            value: a.did || String(a.id),
            label: `${a.preferred_username} (#${a.id})`,
          })));
        } catch {
          if (!disposed) setActorOptions([]);
        }
      }, 200);
    };
    loadOptions('');
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const peersColumns: ColumnsType<iceApi.IcePeer> = useMemo(() => ([
    { title: 'Peer', dataIndex: 'id', key: 'id', render: (v: string) => <Text code>{v}</Text> },
    { title: 'State', dataIndex: 'role', key: 'role', render: (v: string) => roleTag(v || '') },
    { title: 'Role', dataIndex: 'role', key: 'roleText', render: (v: string) => <Text>{v || '-'}</Text> },
    { title: 'Updated', dataIndex: 'updated_at', key: 'updated', width: 180, render: (v: number) => formatTime(new Date(v * 1000).toISOString()) },
  ]), []);

  const sessionsColumns: ColumnsType<iceApi.IceSession> = useMemo(() => ([
    { title: 'Session', dataIndex: 'id', key: 'id', render: (v: string) => <Text code>{v}</Text> },
    { title: 'A', dataIndex: 'a', key: 'a', render: (v: string) => <Text>{v}</Text> },
    { title: 'B', dataIndex: 'b', key: 'b', render: (v: string) => <Text>{v}</Text> },
    { title: 'Created', dataIndex: 'created_at', key: 'created', width: 180, render: (v: number) => formatTime(new Date(v * 1000).toISOString()) },
  ]), []);

  return (
    <Flexbox gap={0}>
      <PageHeader
        title="Transport"
        subtitle="ICE signaling + friend chat persistence"
      />

      <Flexbox style={{ padding: 24 }} gap={16}>
        <Card title="Observe Two Accounts">
          <Flexbox gap={10}>
            <Flexbox horizontal gap={8} align="center">
              <AutoComplete
                style={{ flex: 1 }}
                options={actorOptions}
                value={observerA}
                placeholder="Actor DID A (paste or search preferred_username)"
                onChange={(v) => setObserverA(v)}
                onSearch={(text) => {
                  actorsApi.listActors(1, 20, text || '')
                    .then((res) => {
                      setActorOptions((res.items || []).map((a) => ({
                        value: a.did || String(a.id),
                        label: `${a.preferred_username} (#${a.id})`,
                      })));
                    })
                    .catch(() => setActorOptions([]));
                }}
              />
              <Button onClick={() => copyText(observerA)} disabled={!observerA.trim()}>Copy A</Button>
            </Flexbox>
            <Flexbox horizontal gap={8} align="center">
              <AutoComplete
                style={{ flex: 1 }}
                options={actorOptions}
                value={observerB}
                placeholder="Actor DID B (paste or search preferred_username)"
                onChange={(v) => setObserverB(v)}
                onSearch={(text) => {
                  actorsApi.listActors(1, 20, text || '')
                    .then((res) => {
                      setActorOptions((res.items || []).map((a) => ({
                        value: a.did || String(a.id),
                        label: `${a.preferred_username} (#${a.id})`,
                      })));
                    })
                    .catch(() => setActorOptions([]));
                }}
              />
              <Button onClick={() => copyText(observerB)} disabled={!observerB.trim()}>Copy B</Button>
              <Button onClick={() => { setObserverA(observerB); setObserverB(observerA); }} disabled={!observerA.trim() || !observerB.trim()}>Swap</Button>
            </Flexbox>

            <Flexbox horizontal gap={12} align="center" style={{ flexWrap: 'wrap' }}>
              <Text>signaling_session_id:</Text>
              <Tooltip title="This is the normalized pair key used by signaling: min(A,B)-max(A,B)">
                <Text code>{pairSessionId || '-'}</Text>
              </Tooltip>
              <Button onClick={() => copyText(pairSessionId)} disabled={!pairSessionId}>Copy Session ID</Button>
            </Flexbox>

            <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
              <Tag color={pairSession ? 'green' : 'default'}>session: {pairSession ? 'exists' : 'missing'}</Tag>
              <Tag color={pairOffer?.sdp ? 'green' : 'default'}>offer: {pairOffer?.sdp ? 'yes' : 'no'}</Tag>
              <Tag color={pairAnswer?.sdp ? 'green' : 'default'}>answer: {pairAnswer?.sdp ? 'yes' : 'no'}</Tag>
              <Tag color={(pairCandidates?.candidates?.length || 0) > 0 ? 'green' : 'default'}>
                candidates: {pairCandidates?.candidates?.length || 0}
              </Tag>
              {pairSession?.created_at ? (
                <Text type="secondary">created: {formatTime(new Date(pairSession.created_at * 1000).toISOString())}</Text>
              ) : null}
            </Flexbox>
          </Flexbox>
        </Card>

        <Flexbox horizontal gap={12}>
          <Card style={{ flex: 1 }}>
            <Text strong>ICE Signaling</Text>
            <div style={{ marginTop: 8 }}>
              {iceStats ? (
                <Flexbox gap={6}>
                  <Text>status: <Text code>{iceStats.status}</Text></Text>
                  <Text>peers: <Text code>{iceStats.peers}</Text></Text>
                  <Text>sessions: <Text code>{iceStats.sessions}</Text></Text>
                  <Text>offers/answers: <Text code>{iceStats.offers}/{iceStats.answers}</Text></Text>
                  <Text>candidates: <Text code>{iceStats.candidates}</Text></Text>
                </Flexbox>
              ) : (
                <Text type="secondary">No data</Text>
              )}
            </div>
          </Card>

          <Card style={{ flex: 1 }}>
            <Text strong>Friend Chat</Text>
            <div style={{ marginTop: 8 }}>
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
            </div>
          </Card>
        </Flexbox>

        <Card title="ICE Peers" extra={loading ? <Spin size="small" /> : null}>
          <Table
            dataSource={icePeers}
            columns={peersColumns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 20 }}
          />
        </Card>

        <Card title="ICE Sessions" extra={loading ? <Spin size="small" /> : null}>
          <Table
            dataSource={iceSessions}
            columns={sessionsColumns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 20 }}
          />
        </Card>
      </Flexbox>
    </Flexbox>
  );
}
