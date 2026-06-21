interface StationNetworkIntroLabels {
  title: string;
  alice: string;
  bob: string;
  carol: string;
  dana: string;
  evan: string;
}

interface StationNetworkIntroProps {
  labels: StationNetworkIntroLabels;
}

const VIEW_W = 1440;
const VIEW_H = 900;
// One calm, shared timeline. Every motion is a fraction of this period, so the
// whole field breathes and drifts in sync without per-element offsets.
const PERIOD = '16s';

// A loose, organic field of people — a decentralized social graph with no
// center, weighted to the left so it never crowds the auth card. The larger
// points carry a name; the smaller ones are quiet peers in the wider network.
interface Node {
  x: number;
  y: number;
  /** Relative weight of the soft halo / core. */
  s: number;
  /** Optional person label key — only larger, prominent nodes are named. */
  name?: keyof Omit<StationNetworkIntroLabels, 'title'>;
}

const NODES: Node[] = [
  { x: 232, y: 286, s: 1.15, name: 'alice' },
  { x: 168, y: 512, s: 0.85 },
  { x: 366, y: 408, s: 1.35, name: 'carol' },
  { x: 444, y: 196, s: 0.78 },
  { x: 318, y: 672, s: 0.95, name: 'dana' },
  { x: 540, y: 548, s: 1.05, name: 'bob' },
  { x: 632, y: 320, s: 0.82 },
  { x: 566, y: 762, s: 0.7 },
  { x: 724, y: 596, s: 0.9, name: 'evan' },
  { x: 812, y: 432, s: 0.66 },
  // Peers around the auth card — they fill the quiet corners so the field
  // reads as a whole network rather than a left-side cluster.
  { x: 1015, y: 142, s: 0.74 },
  { x: 1296, y: 158, s: 0.6 },
  { x: 1150, y: 812, s: 0.72 },
  { x: 1342, y: 826, s: 0.58 },
];

// Quiet weak ties — Granovetter's threads that let expression cross communities.
// Chosen to web organically without harsh crossings through the middle.
const EDGES: Array<[number, number]> = [
  [0, 2], [0, 3], [2, 3], [2, 1], [1, 4], [2, 5],
  [3, 6], [6, 5], [5, 8], [5, 7], [4, 7], [6, 9], [8, 9], [2, 6],
  // Ties reaching the peers around the card.
  [6, 10], [9, 10], [10, 11], [9, 11], [8, 12], [9, 13], [12, 13],
];

// Content travelling between people — a message, a photo, a clip, a file. The
// payload itself is the federation/relay in motion; we show what people share,
// not the pipes that carry it.
type FlowKind = 'msg' | 'img' | 'video' | 'file';
interface Flow {
  edge: number;
  kind: FlowKind;
  rev?: boolean;
  phase0: number;
  span: number;
}
const FLOWS: Flow[] = [
  { edge: 0, kind: 'msg', phase0: 0.0, span: 0.3 },
  { edge: 5, kind: 'img', phase0: 0.16, span: 0.32 },
  { edge: 15, kind: 'video', phase0: 0.34, span: 0.32 },
  { edge: 18, kind: 'file', phase0: 0.52, span: 0.32 },
  { edge: 11, kind: 'msg', phase0: 0.68, span: 0.3, rev: true },
  { edge: 20, kind: 'img', phase0: 0.42, span: 0.26 },
];

function edgePath(a: Node, b: Node): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // A gentle, consistent bow gives the web an organic, hand-drawn calm.
  const bend = Math.min(46, len * 0.16);
  const cx = mx + (-dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return `M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}`;
}

const f = (n: number) => Number(n.toFixed(4)).toString();

export function StationNetworkIntro({ labels }: StationNetworkIntroProps) {
  return (
    <section className="pt-network-intro" aria-label={labels.title}>
      <svg
        className="pt-network-intro__mesh"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={labels.title}
      >
        <defs>
          <radialGradient id="pt-node-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(102, 126, 234, 0.30)" />
            <stop offset="55%" stopColor="rgba(118, 90, 162, 0.12)" />
            <stop offset="100%" stopColor="rgba(118, 90, 162, 0)" />
          </radialGradient>
          <radialGradient id="pt-bloom" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(102, 126, 234, 0.12)" />
            <stop offset="100%" stopColor="rgba(102, 126, 234, 0)" />
          </radialGradient>
          <filter id="pt-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
          {EDGES.map(([a, b], i) => (
            <path key={i} id={`pt-edge-${i}`} d={edgePath(NODES[a], NODES[b])} />
          ))}
        </defs>

        {/* Soft ambient depth blooms behind everything. */}
        <circle className="pt-network-intro__bloom" cx="300" cy="380" r="360" fill="url(#pt-bloom)" />
        <circle className="pt-network-intro__bloom" cx="600" cy="640" r="300" fill="url(#pt-bloom)" />

        {/* Quiet weak ties. */}
        {EDGES.map((_, i) => (
          <use key={`edge-${i}`} className="pt-network-intro__tie" href={`#pt-edge-${i}`} />
        ))}

        {/* Content travelling between people: messages, photos, clips, files. */}
        {FLOWS.map((flow, i) => (
          <Flow key={`flow-${i}`} edge={flow.edge} kind={flow.kind} rev={flow.rev} phase0={flow.phase0} span={flow.span} />
        ))}

        {/* The people — soft points of light; the prominent ones carry a name. */}
        {NODES.map((node, i) => (
          <NodeMark key={`node-${i}`} node={node} index={i} labels={labels} />
        ))}
      </svg>
    </section>
  );
}

function NodeMark({ node, index, labels }: { node: Node; index: number; labels: StationNetworkIntroLabels }) {
  // Stagger the breathing so the field shimmers gently instead of pulsing as one.
  const begin = `${((index * 1.7) % 9).toFixed(2)}s`;
  return (
    <g transform={`translate(${node.x} ${node.y})`}>
      <circle className="pt-network-intro__halo" r={42 * node.s} fill="url(#pt-node-halo)">
        <animate
          attributeName="opacity"
          dur="9s"
          begin={begin}
          repeatCount="indefinite"
          values="0.55;0.9;0.55"
          calcMode="spline"
          keyTimes="0;0.5;1"
          keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
        />
      </circle>
      <circle className="pt-network-intro__core" r={2.4 * node.s} />
      {node.name ? (
        <text className="pt-network-intro__label" x={0} y={20 * node.s + 8} textAnchor="middle">
          {labels[node.name]}
        </text>
      ) : null}
    </g>
  );
}

function Flow({
  edge,
  kind,
  rev,
  phase0,
  span,
}: {
  edge: number;
  kind: FlowKind;
  rev?: boolean;
  phase0: number;
  span: number;
}) {
  const start = phase0;
  const end = phase0 + span;
  const e = 0.03;
  const motionKeyTimes = `0;${f(start)};${f(end)};1`;
  const motionKeyPoints = rev ? '1;1;0;0' : '0;0;1;1';
  const opacityKeyTimes = `0;${f(start)};${f(start + e)};${f(end - e)};${f(end)};1`;
  const opacityValues = '0;0;1;1;0;0';
  return (
    <g className="pt-network-intro__flow">
      <g className="pt-network-intro__chip">
        <circle className="pt-network-intro__chip-bg" r="13" filter="url(#pt-glow)" />
        <circle className="pt-network-intro__chip-disc" r="13" />
        <FlowIcon kind={kind} />
      </g>
      <animateMotion
        dur={PERIOD}
        repeatCount="indefinite"
        calcMode="linear"
        keyTimes={motionKeyTimes}
        keyPoints={motionKeyPoints}
      >
        <mpath href={`#pt-edge-${edge}`} />
      </animateMotion>
      <animate attributeName="opacity" dur={PERIOD} repeatCount="indefinite" keyTimes={opacityKeyTimes} values={opacityValues} />
    </g>
  );
}

// Minimal line glyphs (stroke-based) for the kinds of content people share.
// Centred on the origin so they ride the path cleanly.
function FlowIcon({ kind }: { kind: FlowKind }) {
  switch (kind) {
    case 'msg':
      return (
        <path
          className="pt-network-intro__glyph"
          d="M-5.5 -4 H5.5 a1.5 1.5 0 0 1 1.5 1.5 V2 a1.5 1.5 0 0 1 -1.5 1.5 H-1.5 L-4.5 6 V3.5 H-5.5 a1.5 1.5 0 0 1 -1.5 -1.5 V-2.5 a1.5 1.5 0 0 1 1.5 -1.5 Z"
        />
      );
    case 'img':
      return (
        <g className="pt-network-intro__glyph">
          <rect x="-6" y="-5" width="12" height="10" rx="1.6" />
          <circle cx="-2.2" cy="-1.4" r="1.3" fill="currentColor" stroke="none" />
          <path d="M-6 3 L-1.5 -1 L1.5 1.5 L4 -1 L6 1.5" />
        </g>
      );
    case 'video':
      return (
        <g className="pt-network-intro__glyph">
          <rect x="-6.5" y="-4.5" width="9.5" height="9" rx="1.6" />
          <path d="M3 -1.6 L6.8 -4 V4 L3 1.6 Z" />
        </g>
      );
    case 'file':
    default:
      return (
        <path
          className="pt-network-intro__glyph"
          d="M-4 -6 H1.6 L4 -3.6 V6 H-4 Z M1.6 -6 V-3.6 H4 M-1.8 -0.6 H1.8 M-1.8 2 H1.8"
        />
      );
  }
}
