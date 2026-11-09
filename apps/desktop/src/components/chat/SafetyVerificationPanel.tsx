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

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert as PtAlert,
  Button as PtButton,
  Spin as PtSpin,
  Tag as PtTag,
  Tooltip as PtTooltip,
  type Tone,
} from '@peers-touch/ui';
import { Check, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { Schema } from '@peers-touch/schema';
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
  tone: Tone;
  icon: ReactNode;
} {
  switch (state) {
    case 'verified':
      return { label: t('chat.social.verify.statusVerified'), tone: 'success', icon: <ShieldCheck size={14} /> };
    case 'changed':
      return { label: t('chat.social.verify.statusChanged'), tone: 'danger', icon: <ShieldAlert size={14} /> };
    case 'unverified':
    default:
      return { label: t('chat.social.verify.statusUnverified'), tone: 'warning', icon: <ShieldQuestion size={14} /> };
  }
}

export function SafetyVerificationPanel({ localActorPtid, localFingerprint, peerPtid }: Props) {
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
        if (!cancelled) return;
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
    <div className="sc-verify">
      <div className="sc-verify__head">
        <strong>{t('chat.social.verify.title')}</strong>
        <PtTag tone={status.tone} leading={status.icon}>{status.label}</PtTag>
      </div>

      <p className="sc-verify__description">{t('chat.social.verify.description')}</p>

      {trustState === 'changed' && (
        <PtAlert tone="danger" title={t('chat.social.verify.changedWarning')} />
      )}

      {!ready && (
        <div className="sc-verify__loading"><PtSpin size="small" /></div>
      )}

      {ready && (
        <>
          <div className="sc-verify__number-block">
            <span className="sc-verify__label">{t('chat.social.verify.safetyNumberLabel')}</span>
            {safetyNumber ? (
              <code className="sc-verify__number">
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
              </code>
            ) : (
              <PtSpin size="small" />
            )}
          </div>

          <div className="sc-verify__material">
            <div className="sc-verify__qr">
              {qrPayload ? (
                <div className="sc-verify__qr-tile">
                  <Schema.QRCode
                    content={{ kind: 'external-protocol', owner: 'identity.safety-number.v1', value: qrPayload }}
                    constraints={{ size: 288, style: 'classic', errorCorrection: 'Q' }}
                    title={t('chat.social.verify.qrPeerLabel')}
                    errorLabel={t('chat.schema.qrUnavailable')}
                  />
                </div>
              ) : null}
              <span className="sc-verify__label sc-verify__qr-label">
                {t('chat.social.verify.qrPeerLabel')}
              </span>
            </div>

            <div className="sc-verify__fingerprints">
              <div className="sc-verify__fingerprint">
                <span className="sc-verify__label">{t('chat.social.verify.yourFingerprintLabel')}</span>
                <PtTooltip label={localFingerprint}>
                  <code>{localFingerprint}</code>
                </PtTooltip>
              </div>
              <div className="sc-verify__fingerprint">
                <span className="sc-verify__label">{t('chat.social.verify.peerFingerprintLabel')}</span>
                <PtTooltip label={peerMat?.fingerprint || ''}>
                  <code>{peerMat?.fingerprint || '—'}</code>
                </PtTooltip>
              </div>
            </div>
          </div>

          <div className="sc-verify__actions">
            {trustState !== 'verified' ? (
              <PtButton
                actionId="safety-mark-verified"
                emphasis="primary"
                fullWidth
                leading={<Check size={14} />}
                onActivate={handleMarkVerified}
                availability={!peerMat?.fingerprint
                  ? { kind: 'disabled', reason: t('chat.social.verify.statusUnverified') }
                  : undefined}
              >
                {t('chat.social.verify.markVerified')}
              </PtButton>
            ) : (
              <>
                <PtButton
                  actionId="safety-already-verified"
                  fullWidth
                  emphasis="secondary"
                  availability={{ kind: 'disabled', reason: t('chat.social.verify.statusVerified') }}
                  leading={<ShieldCheck size={14} />}
                >
                  {t('chat.social.verify.alreadyVerified', {
                    when: trustRecord ? new Date(trustRecord.verifiedAt).toLocaleString() : '',
                  })}
                </PtButton>
                <PtTooltip label={t('chat.social.verify.resetVerification')}>
                  <PtButton
                    actionId="safety-reset"
                    emphasis="quiet"
                    leading={<RefreshCw size={14} />}
                    aria-label={t('chat.social.verify.resetVerification')}
                    onActivate={handleReset}
                  />
                </PtTooltip>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
