export type OperatorView = "station" | "relay";

export type AttachmentState =
  | "NOT_CONFIGURED"
  | "INVITE_ISSUED"
  | "STATION_ACCEPTED"
  | "PROVING_IDENTITY"
  | "ENROLLING"
  | "RESERVING"
  | "PUBLISHING_ROUTE"
  | "ACTIVE"
  | "RENEWING"
  | "DEGRADED"
  | "RECOVERING"
  | "REVOKING"
  | "DETACHED";

export type AttachmentRow = {
  key: string;
  relayName: string;
  relayPeerId: string;
  controlOrigin: string;
  stationName: string;
  stationPeerId: string;
  nodePeerId: string;
  generation: number;
  visibility: "Public" | "Grant only";
  state: AttachmentState;
  credential: string;
  reservation: string;
  route: string;
  observed: string;
  issue?: string;
  detachedReason?: "Station detached" | "Relay revoked";
};

export type InvitationRow = {
  key: string;
  stationPeerId: string;
  label: string;
  quota: string;
  status: "Active" | "Consumed" | "Expired" | "Revoked";
  expires: string;
};

export type RouteRow = {
  key: string;
  kind: "Direct" | "Circuit";
  via: string;
  destination: string;
  visibility: "Public" | "Grant only";
  state: "Active" | "Degraded" | "Withdrawn";
  expires: string;
};

export const STATION = {
  name: "Home Station",
  stationPeerId: "12D3KooWHomestationQ7pL9m4E2x",
  nodePeerId: "12D3KooWNodeA8vY2qR5n7c1",
  directOrigin: "https://station.home.example",
};

export const RELAY_EU = {
  name: "Edge Relay EU",
  relayPeerId: "12D3KooWRelayEU7sK2nV5c9p",
  controlOrigin: "https://relay-eu.example.net",
};

export const RELAY_AP = {
  name: "Backup Relay AP",
  relayPeerId: "12D3KooWRelayAP9tH4mQ2w8r",
  controlOrigin: "https://relay-ap.example.net",
};

export const INITIAL_ATTACHMENTS: AttachmentRow[] = [
  {
    key: "attachment-eu",
    relayName: RELAY_EU.name,
    relayPeerId: RELAY_EU.relayPeerId,
    controlOrigin: RELAY_EU.controlOrigin,
    stationName: STATION.name,
    stationPeerId: STATION.stationPeerId,
    nodePeerId: STATION.nodePeerId,
    generation: 7,
    visibility: "Public",
    state: "ACTIVE",
    credential: "42m remaining",
    reservation: "47m remaining",
    route: "46m remaining",
    observed: "18s ago",
  },
];

export const INITIAL_INVITATIONS: InvitationRow[] = [
  {
    key: "invite-202",
    stationPeerId: "12D3KooWStudioStation4n8sQ",
    label: "Studio Station",
    quota: "8 clients · 64 MiB/s",
    status: "Active",
    expires: "6h 18m",
  },
  {
    key: "invite-197",
    stationPeerId: "12D3KooWArchiveStation2c6pM",
    label: "Archive Station",
    quota: "4 clients · 32 MiB/s",
    status: "Expired",
    expires: "expired 2d ago",
  },
];

export const RELAY_SERVICE = {
  status: "Ready",
  reservations: 38,
  maxReservations: 256,
  routes: 31,
  admittedNodes: 34,
  publicOrigin: RELAY_EU.controlOrigin,
};

export const ATTACHMENT_STAGES: AttachmentState[] = [
  "STATION_ACCEPTED",
  "PROVING_IDENTITY",
  "ENROLLING",
  "RESERVING",
  "PUBLISHING_ROUTE",
  "ACTIVE",
];

export const buildRoutes = (
  attachments: AttachmentRow[],
): RouteRow[] => [
  {
    key: "route-direct",
    kind: "Direct",
    via: "Direct HTTPS",
    destination: STATION.directOrigin,
    visibility: "Public",
    state: "Active",
    expires: "53m",
  },
  ...attachments
    .filter((item) => item.state !== "DETACHED")
    .map<RouteRow>((item) => ({
      key: `route-${item.key}`,
      kind: "Circuit",
      via: item.relayName,
      destination: item.relayPeerId,
      visibility: item.visibility,
      state:
        item.state === "ACTIVE" || item.state === "RENEWING"
          ? "Active"
          : item.state === "REVOKING"
            ? "Withdrawn"
            : "Degraded",
      expires: item.route,
    })),
];
