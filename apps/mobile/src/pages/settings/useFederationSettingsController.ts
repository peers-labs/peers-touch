import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MobileAuthSession } from '../../features/auth/authSession';
import type { FederationSummary } from '../../gen/proto/domain/federation/federation_projection_service_pb';
import {
  createFederationSettingsGateway, FederationSettingsError,
} from '../../services/gateways/federationSettingsGateway';
import { useSettingsRequests } from './useSettingsRequests';

const errorKey = (failure: unknown) => failure instanceof FederationSettingsError
  ? failure.errorKey : 'mobile.settings.federation.requestFailed';

/** Selected governance projection; mutations always reconcile with Station. */
export function useFederationSettingsController(session: MobileAuthSession | null) {
  const gateway = useMemo(() => session ? createFederationSettingsGateway(session) : null, [session]);
  const requests = useSettingsRequests(gateway, errorKey);
  const [federations, setFederations] = useState<readonly FederationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinOpen, setJoinOpen] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [federationId, setFederationId] = useState('');
  const [joinStatus, setJoinStatus] = useState<string | null>(null);
  const revision = useRef(0);
  const reload = useCallback(async () => {
    if (!gateway) { setLoading(false); return; }
    const current = ++revision.current;
    setLoading(true);
    const response = await requests.run((signal) => gateway.list(signal));
    if (current !== revision.current) return;
    if (response) setFederations(response.federations);
    setLoading(false);
  }, [gateway, requests.run]);
  useEffect(() => {
    void reload();
    return () => { revision.current += 1; };
  }, [reload]);

  const discardJoin = () => {
    if (requests.busy) return;
    setEndpoint(''); setFederationId(''); setJoinOpen(false);
  };
  const join = async () => {
    if (!gateway) return false;
    const response = await requests.run(async (signal) => {
      const id = federationId.trim();
      if (!id || !validEndpoint(endpoint.trim())) {
        throw new FederationSettingsError('mobile.settings.federation.invalidJoin');
      }
      const result = await gateway.join({ federationId: id, federationEndpoint: endpoint.trim() }, signal);
      if (!['active', 'pending'].includes(result.status)) {
        throw new FederationSettingsError();
      }
      const readback = await gateway.list(signal);
      if (result.status === 'active' && !readback.federations.some((entry) => entry.federationId === id && entry.status === 'active')) {
        throw new FederationSettingsError();
      }
      return { result, federations: readback.federations };
    }, true);
    if (!response) return false;
    setFederations(response.federations);
    setJoinStatus(response.result.status);
    setEndpoint(''); setFederationId(''); setJoinOpen(false);
    return true;
  };
  const remove = async (target: FederationSummary) => {
    if (!gateway) return false;
    const response = await requests.run(async (signal) => {
      const deleting = target.capability?.canArchive && target.sequencerStationPeerId === session?.stationPeerId;
      if (!deleting && !target.capability?.canLeave) {
        throw new FederationSettingsError('mobile.settings.federation.denied');
      }
      const result = deleting ? await gateway.delete(target.federationId, signal)
        : await gateway.leave(target.federationId, signal);
      if (!result.success) throw new FederationSettingsError();
      const readback = await gateway.list(signal);
      if (readback.federations.some((entry) => entry.federationId === target.federationId && entry.status === 'active')) {
        throw new FederationSettingsError();
      }
      return readback;
    }, true);
    if (!response) return false;
    setFederations(response.federations);
    return true;
  };
  return {
    federations, loading, busy: requests.busy, error: requests.error,
    joinOpen, endpoint, federationId, joinStatus, reload, join, remove, discardJoin,
    openJoin: () => { setJoinOpen(true); setJoinStatus(null); requests.clearError(); },
    setEndpoint, setFederationId,
    dirty: joinOpen && Boolean(endpoint.trim() || federationId.trim()),
  };
}

function validEndpoint(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
