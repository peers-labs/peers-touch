/**
 * stationLink — prototype mirror of the real mobile station-link business
 * logic (apps/mobile/src/features/station/stationRegistry.ts).
 *
 * The product never asks the user to NAME a station. Adding a station takes a
 * single input — a Station http(s) URL or a private connection code — and the
 * display label is DERIVED from the URL host. These helpers reproduce that
 * contract (normalization, root-origin validation, label extraction, private
 * connection recognition) so the prototype's add flow matches the real device
 * semantics instead of inventing a name field.
 */

const PRIVATE_CODE_PREFIXES = ['ptc1:', 'peers-touch://connect#'];

export function isPrivateConnection(value: string): boolean {
  const raw = value.trim().toLowerCase();
  return PRIVATE_CODE_PREFIXES.some(prefix => raw.startsWith(prefix));
}

/** Normalize to a bare http(s) root origin, or null when not a valid Station
    URL. Mirrors buildStationUrl + normalizeStationAddress + isRootHttpOrigin. */
export function normalizeStationUrl(value: string): string | null {
  const raw = value.trim().replace(/\/+$/, '');
  if (!raw || /\s/.test(raw)) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    const isRootOrigin =
      (url.protocol === 'https:' || url.protocol === 'http:')
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && (url.pathname === '' || url.pathname === '/')
      && !url.search
      && !url.hash;
    return isRootOrigin ? url.origin : null;
  } catch {
    return null;
  }
}

/** Accept either a private connection code (returned verbatim) or a Station URL
    (normalized to its origin). Mirrors buildStationAccessInput. */
export function buildStationAccessInput(value: string): string | null {
  const raw = value.trim();
  if (isPrivateConnection(raw)) return raw;
  return normalizeStationUrl(raw);
}

/** hostname[:port] for a URL; a private code gets the private-connection label. */
export function deriveStationLabel(accessInput: string, privateLabel: string): string {
  if (isPrivateConnection(accessInput)) return privateLabel;
  try {
    const url = new URL(accessInput);
    return url.hostname + (url.port ? `:${url.port}` : '');
  } catch {
    return privateLabel;
  }
}

/** De-duplication key: normalized origin for URLs, the code itself otherwise. */
export function stationIdentityKey(accessInput: string): string {
  return normalizeStationUrl(accessInput) ?? accessInput.trim();
}
