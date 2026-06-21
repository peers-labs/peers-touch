interface StationNetworkIntroProps {
  /** Used only as an accessible label; never rendered as visible text. */
  title: string;
}

const VIEW_W = 1440;
const VIEW_H = 900;
// One calm, shared timeline. Every motion is a fraction of this period, so the
// whole field breathes and drifts in sync without per-element offsets.
const PERIOD = '16s';

// A loose, abstract field of light — people, felt rather than labeled. There is
// deliberately no center and no text: a healthy decentralized social graph is an
// organic constellation, weighted to the left so it never crowds the auth card.
interface Node {
  x: number;
  y: number;
  /** Relative weight of the soft halo / core. */
  s: number;
}

const NODES: Node[] = [
  { x: 232, y: 286, s: 1.15 },
  { x: 168, y: 512, s: 0.85 },
  { x: 366, y: 408, s: 1.35 },
  { x: 444, y: 196, s: 0.78 },
  { x: 318, y: 672, s: 0.95 },
  { x: 540, y: 548, s: 1.05 },
  { x: 632, y: 320, s: 0.82 },
  { x: 566, y: 762, s: 0.7 },
  { x: 724, y: 596, s: 0.9 },
  { x: 812, y: 432, s: 0.66 },
];

// Quiet weak ties — Granovetter's threads that let expression cross communities.
// Chosen to web organically without harsh crossings through the middle.
const EDGES: Array<[number, number]> = [
  [0, 2], [0, 3], [2, 3], [2, 1], [1, 4], [2, 5],
  [3, 6], [6, 5], [5, 8], [5, 7], [4, 7], [6, 9], [8, 9], [2, 6],
];

// A few expressions travelling between people. Each rides one edge, slowly,
// fading in and out so the field feels alive rather than busy.
interface Flow {
  edge: number;
  rev?: boolean;
  phase0: number;
  span: number;
}
const FLOWS: Flow[] = [
  { edge: 0, phase0: 0.04, span: 0.26 },
  { edge: 5, phase0: 0.22, span: 0.3 },
  { edge: 9, phase0: 0.46, span: 0.26, rev: true },
  { edge: 12, phase0: 0.64, span: 0.3 },
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

export function StationNetworkIntro({ title }: StationNetworkIntroProps) {
  return (
    <section className="pt-network-intro" aria-label={title}>
      <svg
        className="pt-network-intro__mesh"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={title}
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

        {/* Expressions travelling between people. */}
        {FLOWS.map((flow, i) => (
          <Flow key={`flow-${i}`} edge={flow.edge} rev={flow.rev} phase0={flow.phase0} span={flow.span} />
        ))}

        {/* The people — felt as soft points of light, not labels. */}
        {NODES.map((node, i) => (
          <NodeMark key={`node-${i}`} node={node} index={i} />
        ))}
      </svg>
    </section>
  );
}

function NodeMark({ node, index }: { node: Node; index: number }) {
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
    </g>
  );
}

function Flow({
  edge,
  rev,
  phase0,
  span,
}: {
  edge: number;
  rev?: boolean;
  phase0: number;
  span: number;
}) {
  const start = phase0;
  const end = phase0 + span;
  const e = 0.02;
  const motionKeyTimes = `0;${f(start)};${f(end)};1`;
  const motionKeyPoints = rev ? '1;1;0;0' : '0;0;1;1';
  const opacityKeyTimes = `0;${f(start)};${f(start + e)};${f(end - e)};${f(end)};1`;
  const opacityValues = '0;0;0.9;0.9;0;0';
  return (
    <g className="pt-network-intro__flow" filter="url(#pt-glow)">
      <circle className="pt-network-intro__flow-halo" r="5" />
      <circle className="pt-network-intro__flow-core" r="1.8" />
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
