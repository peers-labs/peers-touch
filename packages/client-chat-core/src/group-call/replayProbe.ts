import type { GroupCallJoinResponse, GroupCallProvider, Unsubscribe } from './types.js';

interface NativeGroupCallProbeSource {
  onTokenRefreshed(cb: (token: string) => void): Unsubscribe;
  requestSignalReconnect(): Promise<void>;
  onConnectionStateChanged(cb: (state: string) => void): Unsubscribe;
}

/**
 * Acceptance-only negative oracle. Arming happens through the native Harness;
 * capture observes the actual production join response. Credentials remain in
 * this transient closure and are erased after replay or Harness cleanup.
 */
export class GroupCallReplayProbe {
  private armed = false;
  private grant: GroupCallJoinResponse | null = null;
  private refreshedToken: string | null = null;
  private source: NativeGroupCallProbeSource | null = null;
  private detach: Unsubscribe | null = null;

  constructor(private readonly createProvider: () => Promise<GroupCallProvider>) {}

  arm(): void { this.clear(); this.armed = true; }
  capture(grant: GroupCallJoinResponse): void {
    if (!this.armed) return;
    this.armed = false;
    this.grant = { ...grant };
  }
  observe(source: NativeGroupCallProbeSource): void {
    this.detach?.();
    this.source = source;
    this.detach = source.onTokenRefreshed((token) => {
      if (this.grant && this.source === source && token !== this.grant.token) this.refreshedToken = token;
    });
  }
  status(): { hasRefreshedToken: boolean; url: string | null } {
    return { hasRefreshedToken: !!this.refreshedToken, url: this.grant?.url ?? null };
  }
  async reconnect(): Promise<{ requested: boolean; observedReconnecting: boolean }> {
    const source = this.source;
    if (!source) throw new Error('call.replayProbeUnavailable');
    let unsubscribe: Unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observed = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('call.reconnectNotObserved')), 15_000);
      unsubscribe = source.onConnectionStateChanged((state) => {
        if (state === 'reconnecting') resolve();
      });
    });
    // The transport request can fail before the observer's timeout.
    void observed.catch(() => undefined);
    try {
      await source.requestSignalReconnect();
      await observed;
      return { requested: true, observedReconnecting: true };
    } finally { unsubscribe(); if (timer) clearTimeout(timer); }
  }
  clear(): void {
    this.armed = false; this.grant = null; this.refreshedToken = null;
    this.detach?.(); this.detach = null; this.source = null;
  }

  async replay(previousSid: string, tokenKind: 'initial' | 'refreshed' = 'initial', consume = true): Promise<{
    denied: boolean; previousSid: string; replaySid: string;
    observedInitialDenial: boolean; mediaReleased: boolean; tokenKind: 'initial' | 'refreshed';
  }> {
    const grant = this.grant;
    const token = tokenKind === 'refreshed' ? this.refreshedToken : grant?.token;
    if (consume) this.clear();
    if (!grant || !token || !previousSid) throw new Error('call.replayProbeUnavailable');
    const provider = await this.createProvider();
    let settled = false, admitted = false, initialDenial = false, unsafe = false, replaySid = '';
    const connected = provider.connect(grant.url, token)
      .then(() => { admitted = true; }, () => undefined)
      .finally(() => { settled = true; });
    try {
      while (!settled) {
        const media = await provider.readMediaStats();
        if (media.connected && media.participantSid) {
          replaySid = media.participantSid;
          unsafe ||= media.canPublish || media.canSubscribe || media.localLiveTracks > 0;
          initialDenial ||= !media.canPublish && !media.canSubscribe && media.localLiveTracks === 0;
        }
        if (!settled) await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
      await connected;
    } finally {
      await provider.disconnect();
    }
    const released = await provider.readMediaStats();
    const mediaReleased = !released.connected && released.localLiveTracks === 0 && released.tracks.length === 0;
    return {
      denied: !admitted && !unsafe && initialDenial && !!replaySid
        && replaySid !== previousSid && mediaReleased,
      previousSid, replaySid, observedInitialDenial: initialDenial, mediaReleased, tokenKind,
    };
  }
}
