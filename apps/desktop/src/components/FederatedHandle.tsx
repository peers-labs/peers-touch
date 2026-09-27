// FederatedHandle — renders the canonical "@user@host" string with
// graceful fallback to "@user" when the federated form is not
// available yet (e.g. /me has not yet been fetched, or the actor is
// remote-cached without home_station_domain populated).
//
// Used in actor-identity surfaces (profile popover, contact panel,
// chat header). Pure presentation: never fetches, never decides
// visibility — that contract belongs to the FederationRuntime store.
//
// Wire shape:
//   • `localPart` is the bare username ("alice"), without "@".
//   • `home`     is host[:port] from ActorProfile or FederationResolveView. Empty / undefined → render
//     "@<localPart>" only.
//
// Style is intentionally minimal: a small secondary-colored span the
// caller can wrap in any layout container. The component does NOT
// emit margins / paddings / line-height of its own so it composes
// inside flex / grid rows without surprises.

import type { CSSProperties, ReactElement } from 'react';
import { Typography, theme } from 'antd';

const { Text } = Typography;

export interface FederatedHandleProps {
  /** Bare username — no "@" prefix. May be empty during loading. */
  localPart: string;
  /** home_station_domain — host[:port], no scheme. */
  home?: string;
  /** Override the default size (12px) for places that need a tighter or larger glyph. */
  fontSize?: number;
  /** Optional extra inline style; merged on top of the defaults. */
  style?: CSSProperties;
}

export function FederatedHandle({
  localPart,
  home,
  fontSize = 12,
  style,
}: FederatedHandleProps): ReactElement | null {
  const { token } = theme.useToken();
  const trimmedLocal = localPart?.trim() ?? '';
  if (!trimmedLocal) return null;
  const trimmedHome = home?.trim();
  const text = trimmedHome
    ? `@${trimmedLocal}@${trimmedHome}`
    : `@${trimmedLocal}`;
  return (
    <Text
      type="secondary"
      style={{
        fontSize,
        lineHeight: 1.2,
        color: token.colorTextSecondary,
        ...style,
      }}
      ellipsis={{ tooltip: text }}
    >
      {text}
    </Text>
  );
}
