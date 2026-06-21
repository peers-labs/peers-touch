interface StationNetworkIntroLabels {
  title: string;
  alice: string;
  bob: string;
  carol: string;
  dana: string;
  evan: string;
  joining: string;
  yourStation: string;
}

interface StationNetworkIntroProps {
  selectedStationName: string;
  labels: StationNetworkIntroLabels;
}

const VIEW_W = 1440;
const VIEW_H = 900;
// One calm, shared timeline. Every motion is a fraction of this period, so the
// whole constellation breathes and cascades in sync without per-element offsets.
const PERIOD = '13s';

type ClusterId = 'you' | 'c1' | 'c2' | 'c3' | 'c4' | 'c5';

interface Cluster {
  x: number;
  y: number;
  /** Small anonymous companions — the actors this person's Station carries. */
  satellites: { dx: number; dy: number; r: number }[];
}

// A loose constellation of people. There is deliberately no center: clusters
// form an organic ring with a couple of weak ties across it (Granovetter), the
// shape of a healthy decentralized social graph. "You" is just one star — at the
// edge — that we gently help you find.
const CLUSTERS: Record<ClusterId, Cluster> = {
  you: { x: 210, y: 470, satellites: [{ dx: 26, dy: -24, r: 2.4 }, { dx: -24, dy: -10, r: 1.9 }, { dx: 14, dy: 28, r: 2.1 }] },
  c1: { x: 430, y: 170, satellites: [{ dx: 22, dy: 20, r: 2 }, { dx: -20, dy: 14, r: 1.7 }] },
  c2: { x: 720, y: 250, satellites: [{ dx: 24, dy: -18, r: 2.1 }, { dx: -18, dy: 18, r: 1.6 }, { dx: 20, dy: 22, r: 1.8 }] },
  c3: { x: 820, y: 520, satellites: [{ dx: -22, dy: -16, r: 1.9 }, { dx: 20, dy: 16, r: 1.7 }] },
  c4: { x: 600, y: 720, satellites: [{ dx: 24, dy: 14, r: 2 }, { dx: -20, dy: -18, r: 1.6 }, { dx: 6, dy: 26, r: 1.8 }] },
  c5: { x: 340, y: 650, satellites: [{ dx: 22, dy: -20, r: 1.9 }, { dx: -18, dy: 16, r: 1.7 }] },
};

// Weak ties between communities. The ring + chords mean no node is privileged.
interface Tie {
  id: string;
  from: ClusterId;
  to: ClusterId;
  bend: number;
  chord?: boolean;
}
const TIES: Tie[] = [
  { id: 't-you-c1', from: 'you', to: 'c1', bend: -34 },
  { id: 't-c1-c2', from: 'c1', to: 'c2', bend: -30 },
  { id: 't-c2-c3', from: 'c2', to: 'c3', bend: -36 },
  { id: 't-c3-c4', from: 'c3', to: 'c4', bend: -38 },
  { id: 't-c4-c5', from: 'c4', to: 'c5', bend: -30 },
  { id: 't-c5-you', from: 'c5', to: 'you', bend: -32 },
  { id: 't-c1-c4', from: 'c1', to: 'c4', bend: 60, chord: true },
  { id: 't-c2-c5', from: 'c2', to: 'c5', bend: -54, chord: true },
];

// Stories = how an expression spreads. A thought travels hop by hop along weak
// ties (information cascade). One stream reaches home (you), then — reciprocity —
// you speak back out. A third faint pulse keeps the far side of the graph alive.
interface Hop {
  tie: string;
  rev?: boolean;
}
interface Story {
  hops: Hop[];
  phase0: number;
  span: number;
  faint?: boolean;
}
const STORIES: Story[] = [
  // c3 -> c2 -> c1 -> you : the network brings someone's expression home to you.
  { hops: [{ tie: 't-c2-c3', rev: true }, { tie: 't-c1-c2', rev: true }, { tie: 't-you-c1', rev: true }], phase0: 0.03, span: 0.46 },
  // you -> c5 -> c4 : and you speak back out into the federation.
  { hops: [{ tie: 't-c5-you', rev: true }, { tie: 't-c4-c5', rev: true }], phase0: 0.57, span: 0.34 },
  // a quiet cross-graph murmur so the whole mesh feels alive.
  { hops: [{ tie: 't-c2-c5' }], phase0: 0.16, span: 0.18, faint: true },
];

function tiePath(from: Cluster, to: Cluster, bend: number): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return `M${from.x} ${from.y} Q${cx} ${cy} ${to.x} ${to.y}`;
}

const f = (n: number) => Number(n.toFixed(4)).toString();

export function StationNetworkIntro({ selectedStationName, labels }: StationNetworkIntroProps) {
  const names: Record<Exclude<ClusterId, 'you'>, string> = {
    c1: labels.alice,
    c2: labels.bob,
    c3: labels.carol,
    c4: labels.dana,
    c5: labels.evan,
  };

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
          <filter id="pt-glow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="2.6" />
          </filter>
          {TIES.map(tie => (
            <path key={tie.id} id={tie.id} d={tiePath(CLUSTERS[tie.from], CLUSTERS[tie.to], tie.bend)} />
          ))}
        </defs>

        {/* Weak ties between communities. */}
        {TIES.map(tie => (
          <use
            key={`tie-${tie.id}`}
            className={tie.chord ? 'pt-network-intro__tie pt-network-intro__tie--chord' : 'pt-network-intro__tie'}
            href={`#${tie.id}`}
          />
        ))}

        {/* Expression spreading hop by hop through people. */}
        {STORIES.flatMap((story, si) => {
          const slot = story.span / story.hops.length;
          return story.hops.map((hop, hi) => {
            const start = story.phase0 + hi * slot;
            const end = start + slot;
            return (
              <Pulse
                key={`pulse-${si}-${hi}`}
                pathId={hop.tie}
                rev={hop.rev}
                start={start}
                end={end}
                faint={story.faint}
              />
            );
          });
        })}

        {/* The people. */}
        {(Object.keys(names) as Exclude<ClusterId, 'you'>[]).map(id => (
          <Star key={id} cluster={CLUSTERS[id]} label={names[id]} />
        ))}

        {/* You — one star at the edge, gently breathing, flaring when the stream reaches home. */}
        <g className="pt-star pt-star--you" transform={`translate(${CLUSTERS.you.x} ${CLUSTERS.you.y})`}>
          <circle className="pt-star__breath">
            <animate attributeName="r" dur="4.6s" repeatCount="indefinite" values="11;22" />
            <animate attributeName="opacity" dur="4.6s" repeatCount="indefinite" values="0.34;0" />
          </circle>
          <circle className="pt-star__flare">
            <animate attributeName="r" dur={PERIOD} repeatCount="indefinite" keyTimes="0;0.46;0.5;0.66;1" values="10;10;15;26;26" calcMode="linear" />
            <animate attributeName="opacity" dur={PERIOD} repeatCount="indefinite" keyTimes="0;0.46;0.5;0.66;1" values="0;0;0.6;0;0" />
          </circle>
          <circle className="pt-star__glow" r="16" filter="url(#pt-glow)" />
          {CLUSTERS.you.satellites.map((s, i) => (
            <circle key={i} className="pt-star__sat" cx={s.dx} cy={s.dy} r={s.r} />
          ))}
          <circle className="pt-star__core" r="9" />
          <text className="pt-star__label pt-network-intro__placeholder-name" y="34">{labels.joining}</text>
          <g className="pt-network-intro__chosen-name">
            <text className="pt-star__label" y="32">{selectedStationName}</text>
            <text className="pt-star__sublabel" y="49">{labels.yourStation}</text>
          </g>
        </g>
      </svg>
    </section>
  );
}

function Star({ cluster, label }: { cluster: Cluster; label: string }) {
  return (
    <g className="pt-star" transform={`translate(${cluster.x} ${cluster.y})`}>
      <circle className="pt-star__glow" r="12" filter="url(#pt-glow)" />
      {cluster.satellites.map((s, i) => (
        <circle key={i} className="pt-star__sat" cx={s.dx} cy={s.dy} r={s.r} />
      ))}
      <circle className="pt-star__core" r="6.5" />
      <text className="pt-star__label" y="28">{label}</text>
    </g>
  );
}

function Pulse({
  pathId,
  rev,
  start,
  end,
  faint,
}: {
  pathId: string;
  rev?: boolean;
  start: number;
  end: number;
  faint?: boolean;
}) {
  const e = 0.012;
  const peak = faint ? 0.42 : 0.95;
  const motionKeyTimes = `0;${f(start)};${f(end)};1`;
  const motionKeyPoints = rev ? '1;1;0;0' : '0;0;1;1';
  const opacityKeyTimes = `0;${f(start)};${f(start + e)};${f(end - e)};${f(end)};1`;
  const opacityValues = `0;0;${peak};${peak};0;0`;
  return (
    <g className="pt-cascade" filter="url(#pt-glow)">
      <circle className="pt-cascade__halo" r={faint ? 4 : 6} />
      <circle className="pt-cascade__core" r={faint ? 1.5 : 2.3} />
      <animateMotion dur={PERIOD} repeatCount="indefinite" calcMode="linear" keyTimes={motionKeyTimes} keyPoints={motionKeyPoints}>
        <mpath href={`#${pathId}`} />
      </animateMotion>
      <animate attributeName="opacity" dur={PERIOD} repeatCount="indefinite" keyTimes={opacityKeyTimes} values={opacityValues} />
    </g>
  );
}
