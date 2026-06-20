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
  | 'alice'
  | 'aliceStation'
  | 'relay'
  | 'storage'
  | 'service'
  | 'carol'
  | 'bob'
  | 'agent'
  | 'selected';

interface NodePoint {
  x: number;
  y: number;
}

// Spatial layout of the federated mesh. Nodes stay within the left ~55% of the
// canvas so the floating auth card on the right never covers a node, and the
// mesh reads as a calm backdrop rather than a competing foreground.
const NODES: Record<NodeId, NodePoint> = {
  alice: { x: 150, y: 224 },
  aliceStation: { x: 322, y: 384 },
  relay: { x: 540, y: 184 },
  storage: { x: 724, y: 300 },
  service: { x: 660, y: 520 },
  carol: { x: 596, y: 716 },
  bob: { x: 330, y: 660 },
  agent: { x: 150, y: 540 },
  selected: { x: 462, y: 440 },
};

// Curvature offsets keep edges organic instead of straight wires.
const EDGES: { id: string; from: NodeId; to: NodeId; bend: number }[] = [
  { id: 'd-edge-1', from: 'alice', to: 'aliceStation', bend: 32 },
  { id: 'd-edge-2', from: 'aliceStation', to: 'relay', bend: -46 },
  { id: 'd-edge-3', from: 'aliceStation', to: 'selected', bend: 26 },
  { id: 'd-edge-4', from: 'relay', to: 'selected', bend: 40 },
  { id: 'd-edge-5', from: 'relay', to: 'storage', bend: -30 },
  { id: 'd-edge-6', from: 'storage', to: 'service', bend: 34 },
  { id: 'd-edge-7', from: 'service', to: 'selected', bend: -26 },
  { id: 'd-edge-8', from: 'carol', to: 'service', bend: 30 },
  { id: 'd-edge-9', from: 'carol', to: 'selected', bend: -38 },
  { id: 'd-edge-10', from: 'bob', to: 'selected', bend: 26 },
  { id: 'd-edge-11', from: 'bob', to: 'agent', bend: -34 },
  { id: 'd-edge-12', from: 'agent', to: 'selected', bend: -30 },
  { id: 'd-edge-13', from: 'bob', to: 'service', bend: 48 },
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
          <use key={`use-${edge.id}`} className="pt-network-intro__edge" href={`#${edge.id}`} />
        ))}

        <DataToken type="message" edgeId="d-edge-1" label={labels.messageFlow} duration="7.6s" />
        <DataToken type="image" edgeId="d-edge-3" label={labels.imageFlow} duration="8.2s" begin="-2.1s" />
        <DataToken type="file" edgeId="d-edge-6" label={labels.fileFlow} duration="8.8s" begin="-3.4s" />
        <DataToken type="message" edgeId="d-edge-10" label={labels.messageFlow} duration="7.9s" begin="-4.6s" />
        <DataToken type="task" edgeId="d-edge-12" label={labels.taskFlow} duration="9.2s" begin="-1.2s" />
        <DataToken type="image" edgeId="d-edge-9" label={labels.imageFlow} duration="8.4s" begin="-5.8s" />
        <DataToken type="file" edgeId="d-edge-5" label={labels.fileFlow} duration="9.6s" begin="-3.9s" />
        <DataToken type="message" edgeId="d-edge-7" label={labels.messageFlow} duration="8.6s" begin="-6.7s" />

        <NetworkNode point={NODES.alice} label={labels.alice} subLabel={labels.personal} />
        <NetworkNode point={NODES.aliceStation} label={labels.station} subLabel={labels.alice} />
        <NetworkNode point={NODES.relay} label={labels.relay} subLabel={labels.relayLink} />
        <NetworkNode point={NODES.storage} label={labels.storage} subLabel={labels.station} />
        <NetworkNode point={NODES.service} label={labels.service} subLabel={labels.station} />
        <NetworkNode point={NODES.carol} label={labels.station} subLabel={labels.carol} />
        <NetworkNode point={NODES.bob} label={labels.station} subLabel={labels.bob} />
        <NetworkNode point={NODES.agent} label={labels.agent} subLabel={labels.station} />

        <g
          className="pt-network-intro__node pt-network-intro__node--selected"
          transform={`translate(${NODES.selected.x} ${NODES.selected.y})`}
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

function NetworkNode({ point, label, subLabel }: { point: NodePoint; label: string; subLabel: string }) {
  return (
    <g className="pt-network-intro__node" transform={`translate(${point.x} ${point.y})`}>
      <rect className="pt-network-intro__node-hit" x="-58" y="-28" width="116" height="56" rx="18" />
      <text className="pt-network-intro__node-label" y="-2">{label}</text>
      <text className="pt-network-intro__node-sub" y="14">{subLabel}</text>
    </g>
  );
}

function DataToken({
  type,
  edgeId,
  label,
  duration,
  begin,
}: {
  type: 'message' | 'image' | 'file' | 'task';
  edgeId: string;
  label: string;
  duration: string;
  begin?: string;
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
      <animateMotion dur={duration} begin={begin} repeatCount="indefinite">
        <mpath href={`#${edgeId}`} />
      </animateMotion>
    </g>
  );
}
