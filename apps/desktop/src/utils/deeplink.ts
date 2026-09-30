// Deep link URI scheme for in-app navigation.
//
// Format:  pt://<resource>[/<id>[/<sub>[/<subId>]]]
//
// The frontend uses this to decouple navigation from content:
// any message card, tool result, or notification can embed a
// deep link without knowing how pages are structured.

export interface ParsedDeepLink {
  resource: string; // "cron" | "sessions" | "settings" | "channels"
  id?: string;
  subResource?: string;
  subId?: string;
}

const PRIMARY_SCHEME = 'pt://';

export function isDeepLink(uri: string): boolean {
  return uri.startsWith(PRIMARY_SCHEME);
}

export function parseDeepLink(uri: string): ParsedDeepLink | null {
  if (!uri.startsWith(PRIMARY_SCHEME)) return null;
  const path = uri.slice(PRIMARY_SCHEME.length);
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  const result: ParsedDeepLink = { resource: parts[0] };

  switch (result.resource) {
    case 'cron':
      // cron/jobs/<id>[/runs/<runId>]
      if (parts.length >= 3 && parts[1] === 'jobs') {
        result.id = parts[2];
      }
      if (parts.length >= 5 && parts[3] === 'runs') {
        result.subResource = 'runs';
        result.subId = parts[4];
      }
      break;
    case 'sessions':
      if (parts.length >= 2) result.id = parts[1];
      break;
    case 'settings':
      if (parts.length >= 2) result.id = parts[1];
      break;
    case 'channels':
      if (parts.length >= 2) result.id = parts[1];
      break;
  }

  return result;
}
