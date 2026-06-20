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

// Spatial layout of the federated mesh. The selected node sits center-left so it
// stays clear of the floating login card on the right edge.
const NODES: Record<NodeId, NodePoint> = {
  alice: { x: 168, y: 232 },
  aliceStation: { x: 372, y: 392 },
  relay: { x: 612, y: 196 },
  storage: { x: 860, y: 286 },
  service: { x: 792, y: 540 },
  carol: { x: 742, y: 742 },
  bob: { x: 392, y: 700 },
  agent: { x: 158, y: 560 },
  selected: { x: 540, y: 470 },
};

// Curvature offsets keep edges organic instead of straight wires.
const EDGES: { id: string; from: NodeId; to: NodeId; bend: number; hot?: boolean }[] = [
  { id: 'd-edge-1', from: 'alice', to: 'aliceStation', bend: 36, hot: true },
  { id: 'd-edge-2', from: 'aliceStation', to: 'relay', bend: -54 },
  { id: 'd-edge-3', from: 'aliceStation', to: 'selected', bend: 30, hot: true },
  { id: 'd-edge-4', from: 'relay', to: 'selected', bend: 48, hot: true },
  { id: 'd-edge-5', from: 'relay', to: 'storage', bend: -34 },
  { id: 'd-edge-6', from: 'storage', to: 'service', bend: 40 },
  { id: 'd-edge-7', from: 'service', to: 'selected', bend: -30, hot: true },
  { id: 'd-edge-8', from: 'carol', to: 'service', bend: 36 },
  { id: 'd-edge-9', from: 'carol', to: 'selected', bend: -44 },
  { id: 'd-edge-10', from: 'bob', to: 'selected', bend: 30, hot: true },
  { id: 'd-edge-11', from: 'bob', to: 'agent', bend: -40 },
  { id: 'd-edge-12', from: 'agent', to: 'selected', bend: -36 },
  { id: 'd-edge-13', from: 'bob', to: 'service', bend: 56 },
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
          <use
            key={`use-${edge.id}`}
            className={`pt-network-intro__edge${edge.hot ? ' pt-network-intro__edge--hot' : ''}`}
            href={`#${edge.id}`}
          />
        ))}

        <DataToken type="message" edgeId="d-edge-1" colorClass="pt-network-intro__data--blue" label={labels.messageFlow} duration="5.2s" />
        <DataToken type="image" edgeId="d-edge-3" colorClass="pt-network-intro__data--green" label={labels.imageFlow} duration="5.8s" begin="-1.4s" />
        <DataToken type="file" edgeId="d-edge-6" colorClass="pt-network-intro__data--amber" label={labels.fileFlow} duration="6.1s" begin="-2.1s" />
        <DataToken type="message" edgeId="d-edge-10" colorClass="pt-network-intro__data--cyan" label={labels.messageFlow} duration="5.5s" begin="-3.2s" />
        <DataToken type="task" edgeId="d-edge-12" colorClass="pt-network-intro__data--rose" label={labels.taskFlow} duration="6.8s" begin="-0.8s" />
        <DataToken type="image" edgeId="d-edge-9" colorClass="pt-network-intro__data--green" label={labels.imageFlow} duration="5.9s" begin="-4.3s" />
        <DataToken type="file" edgeId="d-edge-5" colorClass="pt-network-intro__data--amber" label={labels.fileFlow} duration="7s" begin="-2.6s" />
        <DataToken type="message" edgeId="d-edge-7" colorClass="pt-network-intro__data--blue" label={labels.messageFlow} duration="6.4s" begin="-5.1s" />
        <DataToken type="task" edgeId="d-edge-8" colorClass="pt-network-intro__data--rose" label={labels.taskFlow} duration="6.6s" begin="-3.7s" />
        <DataToken type="image" edgeId="d-edge-2" colorClass="pt-network-intro__data--cyan" label={labels.imageFlow} duration="6.2s" begin="-1.9s" />

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
          <circle className="pt-network-intro__swap-flash" r="78" />
          <circle className="pt-network-intro__node-halo" r="66" />
          <rect className="pt-network-intro__node-hit" x="-92" y="-46" width="184" height="92" rx="30" />
          <text className="pt-network-intro__node-label pt-network-intro__placeholder-name" y="-4">{labels.station}</text>
          <text className="pt-network-intro__node-sub pt-network-intro__placeholder-name" y="22">{labels.joining}</text>
          <text className="pt-network-intro__node-label pt-network-intro__chosen-name" y="-4">{selectedStationName}</text>
          <text className="pt-network-intro__node-sub pt-network-intro__chosen-name" y="22">{labels.yourStation}</text>
        </g>
      </svg>
    </section>
  );
}

function NetworkNode({ point, label, subLabel }: { point: NodePoint; label: string; subLabel: string }) {
  return (
    <g className="pt-network-intro__node" transform={`translate(${point.x} ${point.y})`}>
      <circle className="pt-network-intro__node-halo" r="58" />
      <rect className="pt-network-intro__node-hit" x="-80" y="-40" width="160" height="80" rx="26" />
      <text className="pt-network-intro__node-label" y="-3">{label}</text>
      <text className="pt-network-intro__node-sub" y="20">{subLabel}</text>
    </g>
  );
}

function DataToken({
  type,
  edgeId,
  colorClass,
  label,
  duration,
  begin,
}: {
  type: 'message' | 'image' | 'file' | 'task';
  edgeId: string;
  colorClass: string;
  label: string;
  duration: string;
  begin?: string;
}) {
  return (
    <g className={`pt-network-intro__data ${colorClass}`} aria-label={label}>
      <g className="pt-network-intro__data-glyph">
        {type === 'message' && (
          <>
            <rect className="pt-network-intro__token-shell" x="-11" y="-8" width="22" height="16" rx="6" />
            <path className="pt-network-intro__token-glyph" d="M-5 -2h10M-5 3h6M-4 8l3 -3" />
          </>
        )}
        {type === 'image' && (
          <>
            <rect className="pt-network-intro__token-shell" x="-10" y="-9" width="20" height="18" rx="5" />
            <path className="pt-network-intro__token-glyph" d="M-6 4l4 -4l3 3l2 -2l4 5M-5 -4h0.1" />
          </>
        )}
        {type === 'file' && (
          <>
            <path className="pt-network-intro__token-shell" d="M-8 -10h11l5 5v15h-16z" />
            <path className="pt-network-intro__token-glyph" d="M2 -10v6h6M-4 0h7M-4 5h8" />
          </>
        )}
        {type === 'task' && (
          <>
            <rect className="pt-network-intro__token-shell" x="-10" y="-9" width="20" height="18" rx="7" />
            <path className="pt-network-intro__token-glyph" d="M-4 0l3 3l6 -7M-5 6h10" />
          </>
        )}
      </g>
      <animateMotion dur={duration} begin={begin} repeatCount="indefinite">
        <mpath href={`#${edgeId}`} />
      </animateMotion>
    </g>
  );
}
