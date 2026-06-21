interface StationNetworkIntroLabels {
  title: string;
  personal: string;
  actor: string;
  relay: string;
  relayLink: string;
  alice: string;
  service: string;
  station: string;
  bob: string;
  carol: string;
  agent: string;
  storage: string;
  mobile: string;
  client: string;
  joining: string;
  yourStation: string;
  messageFlow: string;
  imageFlow: string;
  fileFlow: string;
  taskFlow: string;
}

interface StationNetworkIntroProps {
  selectedStationName: string;
  labels: StationNetworkIntroLabels;
}

const VIEW_W = 1440;
const VIEW_H = 900;

type NodeId =
  | 'homeStation'
  | 'stationB'
  | 'stationC'
  | 'stationD'
  | 'relay'
  | 'mobile'
  | 'person'
  | 'storage'
  | 'service'
  | 'agent';

interface NodePoint {
  x: number;
  y: number;
}

// Spatial layout of the federated mesh.
//
// Federation philosophy: every Station is a peer. There is NO privileged center.
// The user's own Station ("homeStation") is highlighted but deliberately sits at
// the left edge as one peer among many — local "centrality" only exists in the
// single-user view, never in the network. Peer Stations interlink directly
// (ActivityPub / DHT). The Relay is non-central bridge infrastructure that
// fans out between Stations and lets a Mobile client reach its home Station.
// Actors (person/service/agent) and Storage are NOT peers — they hang under the
// Station that owns them.
//
// Nodes stay within the left ~52% of the canvas so the floating auth card on the
// right never covers a node, and the mesh reads as a calm backdrop.
const NODES: Record<NodeId, NodePoint> = {
  // Peer Stations (the federation backbone — no hub among them).
  homeStation: { x: 152, y: 430 },
  stationB: { x: 520, y: 158 },
  stationC: { x: 662, y: 470 },
  stationD: { x: 452, y: 724 },
  // Bridge infrastructure + a remote client reaching its home Station via relay.
  relay: { x: 336, y: 236 },
  mobile: { x: 150, y: 120 },
  // Sub-nodes owned by a Station (actors and storage are not federation peers).
  person: { x: 92, y: 588 },
  storage: { x: 268, y: 606 },
  service: { x: 662, y: 116 },
  agent: { x: 712, y: 636 },
};

type EdgeKind = 'federation' | 'relay' | 'attach';

// Curvature offsets keep edges organic instead of straight wires.
const EDGES: { id: string; from: NodeId; to: NodeId; bend: number; kind: EdgeKind }[] = [
  // Direct peer-to-peer federation links (no traffic routed through a center).
  { id: 'fed-home-b', from: 'homeStation', to: 'stationB', bend: -40, kind: 'federation' },
  { id: 'fed-home-c', from: 'homeStation', to: 'stationC', bend: 56, kind: 'federation' },
  { id: 'fed-b-c', from: 'stationB', to: 'stationC', bend: -34, kind: 'federation' },
  { id: 'fed-c-d', from: 'stationC', to: 'stationD', bend: -30, kind: 'federation' },
  { id: 'fed-home-d', from: 'homeStation', to: 'stationD', bend: -48, kind: 'federation' },
  // Relay bridges: a mobile client reaches its home Station, and the relay
  // fans broadcast traffic out to another Station behind it.
  { id: 'relay-mobile', from: 'mobile', to: 'relay', bend: 20, kind: 'relay' },
  { id: 'relay-home', from: 'relay', to: 'homeStation', bend: -28, kind: 'relay' },
  { id: 'relay-b', from: 'relay', to: 'stationB', bend: -24, kind: 'relay' },
  // Ownership tethers: actors and storage belong to a Station.
  { id: 'own-person', from: 'homeStation', to: 'person', bend: 14, kind: 'attach' },
  { id: 'own-storage', from: 'homeStation', to: 'storage', bend: -16, kind: 'attach' },
  { id: 'own-service', from: 'stationB', to: 'service', bend: 18, kind: 'attach' },
  { id: 'own-agent', from: 'stationC', to: 'agent', bend: -16, kind: 'attach' },
];

function edgePath(from: NodePoint, to: NodePoint, bend: number): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return `M${from.x} ${from.y} Q${cx} ${cy} ${to.x} ${to.y}`;
}

function edgeClass(kind: EdgeKind): string {
  if (kind === 'relay') return 'pt-network-intro__edge pt-network-intro__edge--relay';
  if (kind === 'attach') return 'pt-network-intro__edge pt-network-intro__edge--attach';
  return 'pt-network-intro__edge';
}

export function StationNetworkIntro({ selectedStationName, labels }: StationNetworkIntroProps) {
  return (
    <section className="pt-network-intro" aria-label={labels.title}>
      <div className="pt-network-intro__header">
        <span>{labels.title}</span>
      </div>

      <svg
        className="pt-network-intro__mesh"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={labels.title}
      >
        <defs>
          {EDGES.map(edge => (
            <path key={edge.id} id={edge.id} d={edgePath(NODES[edge.from], NODES[edge.to], edge.bend)} />
          ))}
        </defs>

        {EDGES.map(edge => (
          <use key={`use-${edge.id}`} className={edgeClass(edge.kind)} href={`#${edge.id}`} />
        ))}

        {/* Data flows peer-to-peer and through the relay — never funneled to one hub. */}
        <DataToken type="message" edgeId="fed-home-b" label={labels.messageFlow} duration="7.6s" />
        <DataToken type="image" edgeId="fed-home-c" label={labels.imageFlow} duration="8.2s" begin="-2.1s" />
        <DataToken type="file" edgeId="fed-b-c" label={labels.fileFlow} duration="8.8s" begin="-3.4s" reverse />
        <DataToken type="task" edgeId="relay-home" label={labels.taskFlow} duration="9.2s" begin="-1.2s" />
        <DataToken type="message" edgeId="fed-c-d" label={labels.messageFlow} duration="7.9s" begin="-4.6s" reverse />
        <DataToken type="image" edgeId="relay-b" label={labels.imageFlow} duration="8.4s" begin="-5.8s" />
        <DataToken type="file" edgeId="fed-home-d" label={labels.fileFlow} duration="9.6s" begin="-3.9s" reverse />
        <DataToken type="message" edgeId="relay-mobile" label={labels.messageFlow} duration="8.6s" begin="-6.7s" />

        {/* Sub-nodes owned by a Station. */}
        <NetworkNode point={NODES.person} label={labels.actor} variant="child" />
        <NetworkNode point={NODES.storage} label={labels.storage} variant="child" />
        <NetworkNode point={NODES.service} label={labels.service} variant="child" />
        <NetworkNode point={NODES.agent} label={labels.agent} variant="child" />

        {/* Bridge infrastructure and the remote mobile client. */}
        <NetworkNode point={NODES.mobile} label={labels.mobile} subLabel={labels.client} variant="infra" />
        <NetworkNode point={NODES.relay} label={labels.relay} subLabel={labels.relayLink} variant="infra" />

        {/* Peer Stations (no center). */}
        <NetworkNode point={NODES.stationB} label={labels.bob} subLabel={labels.station} />
        <NetworkNode point={NODES.stationC} label={labels.carol} subLabel={labels.station} />
        <NetworkNode point={NODES.stationD} label={labels.alice} subLabel={labels.station} />

        {/* The user's own Station: highlighted, but still just one peer at the edge. */}
        <g
          className="pt-network-intro__node pt-network-intro__node--selected"
          transform={`translate(${NODES.homeStation.x} ${NODES.homeStation.y})`}
        >
          <circle className="pt-network-intro__swap-flash" r="48" />
          <circle className="pt-network-intro__node-halo" r="40" />
          <rect className="pt-network-intro__node-hit" x="-66" y="-32" width="132" height="64" rx="20" />
          <text className="pt-network-intro__node-label pt-network-intro__placeholder-name" y="-3">{labels.station}</text>
          <text className="pt-network-intro__node-sub pt-network-intro__placeholder-name" y="15">{labels.joining}</text>
          <text className="pt-network-intro__node-label pt-network-intro__chosen-name" y="-3">{selectedStationName}</text>
          <text className="pt-network-intro__node-sub pt-network-intro__chosen-name" y="15">{labels.yourStation}</text>
        </g>
      </svg>
    </section>
  );
}

function NetworkNode({
  point,
  label,
  subLabel,
  variant = 'station',
}: {
  point: NodePoint;
  label: string;
  subLabel?: string;
  variant?: 'station' | 'infra' | 'child';
}) {
  if (variant === 'child') {
    return (
      <g className="pt-network-intro__node pt-network-intro__node--child" transform={`translate(${point.x} ${point.y})`}>
        <rect className="pt-network-intro__node-hit" x="-44" y="-17" width="88" height="34" rx="13" />
        <text className="pt-network-intro__node-label pt-network-intro__node-label--child" y="4">{label}</text>
      </g>
    );
  }

  const className = variant === 'infra'
    ? 'pt-network-intro__node pt-network-intro__node--infra'
    : 'pt-network-intro__node';
  return (
    <g className={className} transform={`translate(${point.x} ${point.y})`}>
      <rect className="pt-network-intro__node-hit" x="-58" y="-28" width="116" height="56" rx="18" />
      <text className="pt-network-intro__node-label" y="-2">{label}</text>
      {subLabel ? <text className="pt-network-intro__node-sub" y="14">{subLabel}</text> : null}
    </g>
  );
}

function DataToken({
  type,
  edgeId,
  label,
  duration,
  begin,
  reverse,
}: {
  type: 'message' | 'image' | 'file' | 'task';
  edgeId: string;
  label: string;
  duration: string;
  begin?: string;
  reverse?: boolean;
}) {
  return (
    <g className="pt-network-intro__data" aria-label={label}>
      {type === 'message' && (
        <>
          <rect className="pt-network-intro__token-shell" x="-9" y="-7" width="18" height="13" rx="5" />
          <path className="pt-network-intro__token-glyph" d="M-4 -2h8M-4 2h5" />
        </>
      )}
      {type === 'image' && (
        <>
          <rect className="pt-network-intro__token-shell" x="-8" y="-7" width="16" height="14" rx="4" />
          <path className="pt-network-intro__token-glyph" d="M-5 3l3 -3l3 3l2 -2l2 3" />
        </>
      )}
      {type === 'file' && (
        <>
          <path className="pt-network-intro__token-shell" d="M-6 -8h8l4 4v12h-12z" />
          <path className="pt-network-intro__token-glyph" d="M2 -8v4h4M-3 1h6M-3 5h6" />
        </>
      )}
      {type === 'task' && (
        <>
          <rect className="pt-network-intro__token-shell" x="-8" y="-7" width="16" height="14" rx="5" />
          <path className="pt-network-intro__token-glyph" d="M-3 0l2 3l5 -6" />
        </>
      )}
      <animateMotion
        dur={duration}
        begin={begin}
        repeatCount="indefinite"
        keyPoints={reverse ? '1;0' : undefined}
        keyTimes={reverse ? '0;1' : undefined}
        calcMode={reverse ? 'linear' : undefined}
      >
        <mpath href={`#${edgeId}`} />
      </animateMotion>
    </g>
  );
}
