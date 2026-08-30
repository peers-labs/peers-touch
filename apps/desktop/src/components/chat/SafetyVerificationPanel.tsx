// Identity-verification UI for friend chats.
//
// Renders, side-by-side:
//   - Both fingerprints (mine + the peer's) in monospace hex.
//   - The derived 12-group safety number for verbal comparison.
//   - A QR code carrying both fingerprints so the peer can scan
//     and compare without reading the digits aloud.
//   - Trust state (`unverified` / `verified` / `changed`) and the
//     "Mark as verified" / "Reset verification" actions.
//
// The panel only renders for friend chats (group safety numbers
// are an N×N problem we deliberately defer until the chat ratchet
// upgrade lands; until then the per-pair mechanism here is enough
// to anchor the UX). It is mounted by `ChatDetailPanel` inside
// the existing "Encryption" section.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Alert, Button, Spin, Tag, theme, Tooltip, Typography } from 'antd';
import { Check, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api, pickLatestKeyExchangeBundle } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import {
  buildSafetyQrPayload,
  deriveSafetyNumber,
} from '../../modules/identity/safetyNumber';
import {
  evaluateTrust,
  getPeerTrust,
  markVerified,
  clearTrust,
  type PeerTrustState,
} from '../../modules/identity/peerTrust';

const { Text, Paragraph } = Typography;

interface Props {
  /** The local actor's DID — used to scope the trust ledger. */
  localActorPtid: string;
  /** The local actor's hex fingerprint (Ed25519 SHA-256). */
  localFingerprint: string;
  /** The peer DID we're verifying against. */
  peerPtid: string;
}

interface PeerMaterial {
  fingerprint: string;
  loadedAt: number;
}

function formatSafetyNumber(s: string): string {
  // Pad render to 4 lines × 3 groups so the layout stays stable
  // across rerenders even when the iterated hash is still pending.
  if (!s) return '';
  return s;
}

function statusFor(state: PeerTrustState, t: ReturnType<typeof useTranslation>['t']): {
  label: string;
  color: 'success' | 'warning' | 'error';
  icon: React.ReactNode;
} {
  switch (state) {
    case 'verified':
      return { label: t('chat.social.verify.statusVerified'), color: 'success', icon: <ShieldCheck size={14} /> };
    case 'changed':
      return { label: t('chat.social.verify.statusChanged'), color: 'error', icon: <ShieldAlert size={14} /> };
    case 'unverified':
    default:
      return { label: t('chat.social.verify.statusUnverified'), color: 'warning', icon: <ShieldQuestion size={14} /> };
  }
}

export function SafetyVerificationPanel({ localActorPtid, localFingerprint, peerPtid }: Props) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [peerMat, setPeerMat] = useState<PeerMaterial | null>(null);
  const [loading, setLoading] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState<string>('');
  // `tick` lets us re-evaluate the trust state after Mark / Reset
  // without lifting the entire ledger into React state. Cheap and
  // keeps the client-storage-backed ledger as the source of truth.
  const [tick, setTick] = useState(0);

  // Pull the peer's published bundle(s). Prefer the latest `device_id` row's
  // `fingerprint` field (SHA-256 hex over the verifying key) computed by the
  // desktop stub from `ik_pub`.
  useEffect(() => {
    if (!peerPtid) return;
    let cancelled = false;
    setLoading(true);
    api
      .keyExchangeFetchBundle(peerPtid)
      .then((resp) => {
        if (cancelled) return;
        const bundle = pickLatestKeyExchangeBundle(resp);
        const fp = String(bundle?.fingerprint || '').trim();
        if (!fp) {
          log.warn('safetyPanel', 'peer bundle missing fingerprint', { peerPtid });
        }
        setPeerMat({ fingerprint: fp, loadedAt: Date.now() });
      })
      .catch((err) => {
        if (cancelled) return;
        log.warn('safetyPanel', 'fetch peer bundle failed', { peerPtid, error: String(err) });
        setPeerMat({ fingerprint: '', loadedAt: Date.now() });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [peerPtid]);

  // Derive the safety number whenever either fingerprint changes.
  useEffect(() => {
    let cancelled = false;
    if (!peerMat?.fingerprint || !localFingerprint) {
      setSafetyNumber('');
      return;
    }
    deriveSafetyNumber(localFingerprint, peerMat.fingerprint)
      .then((sn) => {
        if (!cancelled) setSafetyNumber(sn);
      })
      .catch((err) => {
        if (cancelled) return;
        log.warn('safetyPanel', 'derive safety number failed', { error: String(err) });
        setSafetyNumber('');
      });
    return () => {
      cancelled = true;
    };
  }, [localFingerprint, peerMat?.fingerprint]);

  const trustState: PeerTrustState = useMemo(() => {
    if (!peerMat?.fingerprint) return 'unverified';
    return evaluateTrust(localActorPtid, peerPtid, peerMat.fingerprint);
    // tick forces re-eval after mutation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localActorPtid, peerPtid, peerMat?.fingerprint, tick]);

  const trustRecord = useMemo(() => {
    return getPeerTrust(localActorPtid, peerPtid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localActorPtid, peerPtid, tick]);

  const qrPayload = useMemo(() => {
    if (!peerMat?.fingerprint || !localFingerprint) return '';
    return buildSafetyQrPayload(localActorPtid, localFingerprint, peerPtid, peerMat.fingerprint);
  }, [localActorPtid, localFingerprint, peerPtid, peerMat?.fingerprint]);

  const handleMarkVerified = () => {
    if (!peerMat?.fingerprint) return;
    markVerified(localActorPtid, peerPtid, peerMat.fingerprint);
    setTick((n) => n + 1);
  };

  const handleReset = () => {
    clearTrust(localActorPtid, peerPtid);
    setTick((n) => n + 1);
  };

  const status = statusFor(trustState, t);
  const ready = !loading && peerMat?.fingerprint && localFingerprint;

  return (
    <Flexbox gap={10} style={{ padding: '12px 16px' }}>
      <Flexbox horizontal align="center" justify="space-between">
        <Flexbox horizontal align="center" gap={6}>
          <Text strong style={{ fontSize: 13 }}>
            {t('chat.social.verify.title')}
          </Text>
        </Flexbox>
        <Tag color={status.color} icon={status.icon} style={{ marginInlineEnd: 0 }}>
          {status.label}
        </Tag>
      </Flexbox>

      <Paragraph type="secondary" style={{ fontSize: 11, margin: 0 }}>
        {t('chat.social.verify.description')}
      </Paragraph>

      {trustState === 'changed' && (
        <Alert
          showIcon
          type="error"
          message={t('chat.social.verify.changedWarning')}
          style={{ padding: '6px 10px', fontSize: 12 }}
        />
      )}

      {!ready && (
        <Flexbox align="center" justify="center" style={{ padding: '12px 0' }}>
          <Spin size="small" />
        </Flexbox>
      )}

      {ready && (
        <>
          <Flexbox gap={4}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('chat.social.verify.safetyNumberLabel')}
            </Text>
            {safetyNumber ? (
              <Text
                code
                style={{
                  fontSize: 13,
                  letterSpacing: 1.5,
                  background: token.colorFillTertiary,
                  padding: '8px 10px',
                  borderRadius: 6,
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {/* Re-group into 4 rows of 3 groups for readability;
                    the wire form is the same single-line string. */}
                {(() => {
                  const groups = formatSafetyNumber(safetyNumber).split(' ');
                  const rows: string[] = [];
                  for (let i = 0; i < groups.length; i += 3) {
                    rows.push(groups.slice(i, i + 3).join('  '));
                  }
                  return rows.join('\n');
                })()}
              </Text>
            ) : (
              <Spin size="small" />
            )}
          </Flexbox>

          <Flexbox horizontal gap={12} align="flex-start">
            <Flexbox align="center" gap={6} style={{ flexShrink: 0 }}>
              {qrPayload ? (
                <div
                  style={{
                    background: '#fff',
                    padding: 6,
                    borderRadius: 6,
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <QRCodeSVG value={qrPayload} size={120} level="M" includeMargin={false} />
                </div>
              ) : null}
              <Text type="secondary" style={{ fontSize: 10, textAlign: 'center' }}>
                {t('chat.social.verify.qrPeerLabel')}
              </Text>
            </Flexbox>

            <Flexbox gap={6} style={{ minWidth: 0, flex: 1 }}>
              <Flexbox gap={2}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {t('chat.social.verify.yourFingerprintLabel')}
                </Text>
                <Tooltip title={localFingerprint}>
                  <Text
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      wordBreak: 'break-all',
                    }}
                  >
                    {localFingerprint}
                  </Text>
                </Tooltip>
              </Flexbox>
              <Flexbox gap={2}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {t('chat.social.verify.peerFingerprintLabel')}
                </Text>
                <Tooltip title={peerMat?.fingerprint || ''}>
                  <Text
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      wordBreak: 'break-all',
                    }}
                  >
                    {peerMat?.fingerprint || '—'}
                  </Text>
                </Tooltip>
              </Flexbox>
            </Flexbox>
          </Flexbox>

          <Flexbox horizontal gap={6}>
            {trustState !== 'verified' ? (
              <Button
                type="primary"
                icon={<Check size={14} />}
                size="small"
                onClick={handleMarkVerified}
                disabled={!peerMat?.fingerprint}
                block
              >
                {t('chat.social.verify.markVerified')}
              </Button>
            ) : (
              <>
                <Button
                  size="small"
                  icon={<ShieldCheck size={14} />}
                  disabled
                  style={{ flex: 1 }}
                >
                  {t('chat.social.verify.alreadyVerified', {
                    when: trustRecord ? new Date(trustRecord.verifiedAt).toLocaleString() : '',
                  })}
                </Button>
                <Tooltip title={t('chat.social.verify.resetVerification')}>
                  <Button size="small" icon={<RefreshCw size={14} />} onClick={handleReset} />
                </Tooltip>
              </>
            )}
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
}
