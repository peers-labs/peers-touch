import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Globe2, Loader2, Mail, Server, ShieldCheck, UserRound } from 'lucide-react';

type ViewMode = 'pin' | 'accounts' | 'signin';
type FlowKind = 'message' | 'image' | 'file' | 'video';

const PIN_LENGTH = 6;

const nodes = [
  { x: 232, y: 286, s: 1.15, name: 'Mira', station: 'aspen' },
  { x: 168, y: 512, s: 0.85 },
  { x: 366, y: 408, s: 1.35, name: 'Lena', station: 'cedar' },
  { x: 444, y: 196, s: 0.78 },
  { x: 318, y: 672, s: 0.95, name: 'Sam', station: 'loom' },
  { x: 540, y: 548, s: 1.05, name: 'Theo', station: 'ridge' },
  { x: 632, y: 320, s: 0.82 },
  { x: 566, y: 762, s: 0.7 },
  { x: 724, y: 596, s: 0.9, name: 'Noor', station: 'tide' },
  { x: 812, y: 432, s: 0.66 },
  { x: 1015, y: 142, s: 0.74 },
  { x: 1296, y: 158, s: 0.6 },
  { x: 1150, y: 812, s: 0.72 },
  { x: 1342, y: 826, s: 0.58 },
];

const edges = [
  [0, 2], [0, 3], [2, 3], [2, 1], [1, 4], [2, 5],
  [3, 6], [6, 5], [5, 8], [5, 7], [4, 7], [6, 9], [8, 9], [2, 6],
  [6, 10], [9, 10], [10, 11], [9, 11], [8, 12], [9, 13], [12, 13],
  [2, 4],
] as const;

const flows = [
  { edge: 0, kind: 'message' as FlowKind, delay: '0s', dur: '8.8s' },
  { edge: 5, kind: 'image' as FlowKind, delay: '-2.2s', dur: '9.6s', route: { from: 2, to: 5, relay: 'tide' } },
  { edge: 8, kind: 'video' as FlowKind, delay: '-4.6s', dur: '10.2s', route: { from: 5, to: 8, relay: 'ridge' } },
  { edge: 21, kind: 'file' as FlowKind, delay: '-6.4s', dur: '9.2s' },
  { edge: 15, kind: 'image' as FlowKind, delay: '-1.4s', dur: '10.8s' },
  { edge: 18, kind: 'file' as FlowKind, delay: '-5.1s', dur: '11.4s' },
] as const;

const css = `
@keyframes pt-login-drift {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(-8px, 6px, 0) scale(1.01); }
}

@keyframes pt-spin {
  to { transform: rotate(360deg); }
}

.pt-login-prototype {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  color: #1f2433;
  background:
    radial-gradient(circle at 20% 24%, rgba(110, 129, 255, .13), transparent 34%),
    radial-gradient(circle at 74% 18%, rgba(160, 136, 255, .10), transparent 32%),
    linear-gradient(135deg, #fbfcff 0%, #f6f8ff 56%, #eef2fb 100%);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.pt-login-prototype * {
  box-sizing: border-box;
}

.pt-login-bg {
  position: absolute;
  inset: -4%;
  pointer-events: auto;
  opacity: 1;
  animation: pt-login-drift 18s ease-in-out infinite;
  will-change: transform;
}

.pt-login-bg::before,
.pt-login-bg::after {
  content: "";
  position: absolute;
  border-radius: 999px;
  filter: blur(36px);
  opacity: .42;
}

.pt-login-bg::before {
  width: 440px;
  height: 440px;
  left: 11%;
  top: 28%;
  background: rgba(108, 126, 234, .16);
}

.pt-login-bg::after {
  width: 360px;
  height: 360px;
  right: 7%;
  bottom: 2%;
  background: rgba(132, 106, 216, .11);
}

.pt-login-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
}

.pt-login-station-name {
  fill: rgba(60, 66, 110, .50);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: .01em;
}

.pt-login-station-meta {
  fill: rgba(102, 126, 234, .34);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.pt-login-tie {
  fill: none;
  stroke: rgba(102, 126, 234, .10);
  stroke-width: 1;
  stroke-linecap: round;
}

.pt-login-tie--main {
  stroke: rgba(102, 126, 234, .18);
}

.pt-login-relay-hop {
  fill: none;
  stroke: rgba(118, 90, 162, .30);
  stroke-width: 1.1;
  stroke-dasharray: 4 7;
  stroke-linecap: round;
}

.pt-login-relay-shell {
  fill: rgba(255, 255, 255, .72);
  stroke: rgba(118, 90, 162, .30);
  stroke-width: 1;
}

.pt-login-relay-core {
  fill: rgba(118, 90, 162, .68);
}

.pt-login-relay-label {
  fill: rgba(118, 90, 162, .56);
  font-size: 8px;
  font-weight: 650;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.pt-login-relay-name {
  fill: rgba(82, 64, 120, .48);
  font-size: 10px;
  font-weight: 600;
}

.pt-login-flow-chip {
  opacity: 0;
  pointer-events: auto;
}

.pt-login-flow-chip--held {
  opacity: 1;
}

.pt-login-flow-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 34;
  stroke-linecap: round;
  pointer-events: stroke;
}

.pt-login-flow-chip__icon {
  fill: none;
  stroke: rgba(102, 126, 234, .68);
  stroke-width: 1.35;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pt-login-node-halo {
  fill: rgba(102, 126, 234, .045);
}

.pt-login-node-core {
  fill: rgba(102, 126, 234, .72);
}

.pt-login-node-hit {
  fill: transparent;
  pointer-events: all;
}

.pt-login-node-card {
  fill: rgba(255, 255, 255, .84);
  stroke: rgba(102, 126, 234, .18);
  stroke-width: 1;
  pointer-events: none;
}

.pt-login-node-card-name {
  fill: rgba(35, 41, 66, .78);
  font-size: 12px;
  font-weight: 650;
  pointer-events: none;
}

.pt-login-node-card-station {
  fill: rgba(102, 126, 234, .58);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: .06em;
  text-transform: uppercase;
  pointer-events: none;
}

.pt-login-card {
  position: absolute;
  right: clamp(48px, 7vw, 104px);
  top: 50%;
  width: min(420px, calc(100vw - 48px));
  min-height: 430px;
  transform: translateY(-50%);
  border-radius: 30px;
  border: 1px solid rgba(255, 255, 255, .78);
  background: rgba(255, 255, 255, .70);
  box-shadow: 0 26px 80px rgba(38, 45, 84, .16), inset 0 1px 0 rgba(255, 255, 255, .82);
  backdrop-filter: blur(28px) saturate(1.18);
  -webkit-backdrop-filter: blur(28px) saturate(1.18);
  padding: 24px;
}

.pt-login-card__top {
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: rgba(51, 56, 82, .58);
  font-size: 13px;
}

.pt-login-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  cursor: pointer;
}

.pt-login-modebar {
  display: flex;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(244, 246, 253, .86);
  border: 1px solid rgba(104, 116, 170, .08);
}

.pt-login-modebar button {
  height: 26px;
  border: 0;
  border-radius: 999px;
  padding: 0 10px;
  background: transparent;
  color: rgba(73, 78, 117, .55);
  font-size: 12px;
  cursor: pointer;
}

.pt-login-modebar button[data-active="true"] {
  background: #fff;
  color: #3a3f67;
  box-shadow: 0 5px 16px rgba(43, 50, 91, .08);
}

.pt-login-avatar {
  width: 64px;
  height: 64px;
  margin: 38px auto 16px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  color: #5f6fe8;
  background: linear-gradient(145deg, rgba(255, 255, 255, .98), rgba(239, 242, 255, .8));
  border: 1px solid rgba(99, 113, 198, .12);
  box-shadow: 0 16px 34px rgba(70, 79, 137, .10);
}

.pt-login-title {
  text-align: center;
  font-size: 18px;
  line-height: 1.25;
  font-weight: 700;
  color: #161a27;
}

.pt-login-subtitle {
  margin-top: 8px;
  text-align: center;
  font-size: 13px;
  line-height: 1.45;
  color: rgba(57, 63, 94, .52);
}

.pt-pin-row {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 30px;
}

.pt-pin-cell {
  width: 48px;
  height: 52px;
  border-radius: 15px;
  border: 1px solid rgba(71, 80, 125, .16);
  background: rgba(255, 255, 255, .66);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .84);
  display: grid;
  place-items: center;
  transition: border-color .18s ease, background .18s ease, box-shadow .18s ease;
}

.pt-pin-cell[data-filled="true"] {
  border-color: rgba(101, 116, 232, .36);
  background: rgba(249, 250, 255, .92);
  box-shadow: 0 8px 20px rgba(96, 108, 187, .08);
}

.pt-pin-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #29304a;
  opacity: .88;
}

.pt-card-action {
  width: 100%;
  height: 46px;
  margin-top: 28px;
  border: 0;
  border-radius: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  background: linear-gradient(135deg, #6574e8, #7f6dde);
  box-shadow: 0 16px 34px rgba(100, 112, 228, .25);
  cursor: pointer;
}

.pt-card-action[disabled] {
  cursor: default;
  opacity: .76;
}

.pt-spin {
  animation: pt-spin .9s linear infinite;
}

.pt-login-note {
  margin-top: 18px;
  padding: 12px 14px;
  border-radius: 15px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(245, 247, 255, .72);
  color: rgba(54, 61, 93, .58);
  font-size: 12px;
  line-height: 1.45;
}

.pt-account-list {
  display: grid;
  gap: 10px;
  margin-top: 28px;
}

.pt-account-item {
  height: 64px;
  border-radius: 18px;
  border: 1px solid rgba(71, 80, 125, .11);
  background: rgba(255, 255, 255, .58);
  display: grid;
  grid-template-columns: 42px 1fr 18px;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
}

.pt-mini-avatar {
  width: 42px;
  height: 42px;
  border-radius: 13px;
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 700;
  background: linear-gradient(145deg, #6674e8, #9a8df0);
}

.pt-account-name {
  font-size: 14px;
  font-weight: 700;
  color: #20263b;
}

.pt-account-meta {
  margin-top: 3px;
  font-size: 12px;
  color: rgba(58, 65, 99, .50);
}

.pt-oauth-row {
  display: flex;
  gap: 10px;
  margin-top: 24px;
}

.pt-oauth-btn {
  flex: 1;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid rgba(71, 80, 125, .13);
  border-radius: 13px;
  background: rgba(255, 255, 255, .58);
  color: #2d3352;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s, border-color .15s, box-shadow .15s;
}

.pt-oauth-btn:hover:not([disabled]) {
  background: rgba(255, 255, 255, .88);
  border-color: rgba(71, 80, 125, .22);
  box-shadow: 0 6px 18px rgba(43, 50, 91, .06);
}

.pt-oauth-btn[disabled] {
  opacity: .56;
  cursor: default;
}

.pt-oauth-wechat:hover:not([disabled]) {
  border-color: rgba(7, 193, 96, .32);
}

.pt-oauth-github:hover:not([disabled]) {
  border-color: rgba(36, 41, 47, .28);
}

.pt-oauth-google:hover:not([disabled]) {
  border-color: rgba(66, 133, 244, .28);
}

.pt-signin-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0 4px;
  color: rgba(57, 63, 94, .36);
  font-size: 12px;
  font-weight: 500;
}

.pt-signin-divider::before,
.pt-signin-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: rgba(71, 80, 125, .10);
}

.pt-signin-form {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.pt-signin-form label {
  display: grid;
  gap: 7px;
  font-size: 12px;
  font-weight: 650;
  color: rgba(51, 57, 88, .58);
}

.pt-signin-form input {
  height: 46px;
  border: 1px solid rgba(71, 80, 125, .13);
  border-radius: 15px;
  outline: 0;
  background: rgba(255, 255, 255, .64);
  padding: 0 14px;
  color: #20263b;
  font-size: 14px;
}

.pt-login-status {
  position: absolute;
  left: clamp(24px, 6vw, 72px);
  bottom: 28px;
  display: flex;
  gap: 10px;
}

.pt-status-pill {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, .76);
  background: rgba(255, 255, 255, .58);
  color: rgba(49, 55, 83, .58);
  font-size: 12px;
  backdrop-filter: blur(14px);
}

.pt-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #46c36f;
  box-shadow: 0 0 0 5px rgba(70, 195, 111, .12);
}

@media (max-width: 900px) {
  .pt-login-card {
    left: 24px;
    right: 24px;
    margin: auto;
  }

  .pt-login-bg {
    opacity: .56;
  }

  .pt-login-status {
    left: 24px;
  }
}
`;

function pathBetween(a: (typeof nodes)[number], b: (typeof nodes)[number]) {
  const ax = a.x;
  const ay = a.y;
  const bx = b.x;
  const by = b.y;
  const cx = (ax + bx) / 2 + (by - ay) * 0.12;
  const cy = (ay + by) / 2 - (bx - ax) * 0.12;
  return `M ${ax.toFixed(1)} ${ay.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
}

function nodePoint(index: number) {
  const node = nodes[index];
  return { x: node.x, y: node.y };
}

function relayPoint(fromIndex: number, toIndex: number) {
  const from = nodePoint(fromIndex);
  const to = nodePoint(toIndex);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: (from.x + to.x) / 2 + (dy / len) * 48,
    y: (from.y + to.y) / 2 - (dx / len) * 48,
  };
}

function relayHopPath(fromIndex: number, relay: { x: number; y: number }, toIndex: number) {
  const from = nodePoint(fromIndex);
  const to = nodePoint(toIndex);
  return [
    `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${((from.x + relay.x) / 2).toFixed(1)} ${(from.y - 42).toFixed(1)} ${relay.x} ${relay.y}`,
    `M ${relay.x} ${relay.y} Q ${((to.x + relay.x) / 2).toFixed(1)} ${(to.y + 42).toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
  ];
}

function flowHoldPoint(flow: (typeof flows)[number]) {
  if ('route' in flow) {
    return relayPoint(flow.route.from, flow.route.to);
  }

  const [fromIndex, toIndex] = edges[flow.edge];
  const from = nodePoint(fromIndex);
  const to = nodePoint(toIndex);
  const control = {
    x: (from.x + to.x) / 2 + (to.y - from.y) * 0.12,
    y: (from.y + to.y) / 2 - (to.x - from.x) * 0.12,
  };

  return {
    x: from.x * 0.25 + control.x * 0.5 + to.x * 0.25,
    y: from.y * 0.25 + control.y * 0.5 + to.y * 0.25,
  };
}

function StationNode({
  node,
  index,
  onHover,
  onLeave,
}: {
  node: (typeof nodes)[number];
  index: number;
  onHover: (index: number) => void;
  onLeave: () => void;
}) {
  if (!node.name || !node.station) {
    return (
      <g transform={`translate(${node.x} ${node.y})`}>
        <circle className="pt-login-node-halo" r={14 * node.s} />
        <circle className="pt-login-node-core" r={2.3 * node.s} />
        <circle
          className="pt-login-node-hit"
          r={Math.max(18, 22 * node.s)}
          onMouseOver={() => onHover(index)}
          onMouseOut={onLeave}
          onPointerOver={() => onHover(index)}
          onPointerOut={onLeave}
          onPointerLeave={onLeave}
        />
      </g>
    );
  }

  return (
    <g transform={`translate(${node.x} ${node.y})`}>
      <circle className="pt-login-node-halo" r={18 * node.s} />
      <circle className="pt-login-node-core" r={2.6 * node.s} />
      <text className="pt-login-station-name" x="0" y={18 * node.s + 8} textAnchor="middle">{node.name}</text>
      <circle
        className="pt-login-node-hit"
        r={Math.max(22, 26 * node.s)}
        onMouseOver={() => onHover(index)}
        onMouseOut={onLeave}
        onPointerOver={() => onHover(index)}
        onPointerOut={onLeave}
        onPointerLeave={onLeave}
      />
    </g>
  );
}

function NodeInfoCard({ node }: { node: (typeof nodes)[number] }) {
  const cardX = node.x + 16 > 1320 ? node.x - 112 : node.x + 16;
  const cardY = node.y - 50 < 24 ? node.y + 18 : node.y - 50;
  const name = node.name ?? 'Peer';
  const station = node.station ? `${node.station} station` : 'remote peer';

  return (
    <g transform={`translate(${cardX} ${cardY})`}>
      <rect className="pt-login-node-card" x="0" y="0" width="96" height="42" rx="10" />
      <text className="pt-login-node-card-name" x="12" y="17">{name}</text>
      <text className="pt-login-node-card-station" x="12" y="31">{station}</text>
    </g>
  );
}

function FlowGlyph({ kind }: { kind: FlowKind }) {
  switch (kind) {
    case 'image':
      return (
        <g className="pt-login-flow-chip__icon">
          <rect x="-5.5" y="-4.5" width="11" height="9" rx="1.6" />
          <circle cx="-2.4" cy="-1.7" r=".9" fill="currentColor" stroke="none" />
          <path d="M-5.5 3 L-2 -1 L1 1.4 L3 -1 L5.5 2.8" />
        </g>
      );
    case 'file':
      return <path className="pt-login-flow-chip__icon" d="M-4 -5.5 H1.2 L4 -2.7 V5.5 H-4 Z M1.2 -5.5 V-2.7 H4 M-1.6 .8 H1.8 M-1.6 3 H1.8" />;
    case 'video':
      return (
        <g className="pt-login-flow-chip__icon">
          <rect x="-5.5" y="-4.5" width="8.5" height="9" rx="1.6" />
          <path d="M3 -2 L5.8 -4 V4 L3 2 Z" />
        </g>
      );
    case 'message':
    default:
      return <path className="pt-login-flow-chip__icon" d="M-5.5 -4 H5.5 a1.6 1.6 0 0 1 1.6 1.6 V1.8 a1.6 1.6 0 0 1 -1.6 1.6 H-1.5 L-4.7 5.8 V3.4 H-5.5 a1.6 1.6 0 0 1 -1.6 -1.6 V-2.4 a1.6 1.6 0 0 1 1.6 -1.6 Z" />;
  }
}

function RelayMarker({
  name,
  x,
  y,
}: {
  name: string;
  x: number;
  y: number;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect className="pt-login-relay-shell" x="-9" y="-9" width="18" height="18" rx="4" transform="rotate(45)" />
      <circle className="pt-login-relay-core" r="2.8" />
      <text className="pt-login-relay-label" x="0" y="28" textAnchor="middle">relay</text>
      <text className="pt-login-relay-name" x="0" y="42" textAnchor="middle">{name}</text>
    </g>
  );
}

function SvgNetworkLayer() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredFlow, setHoveredFlow] = useState<number | null>(null);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const hoveredFlowData = hoveredFlow === null ? null : flows[hoveredFlow];
  const hoveredRoute = hoveredFlowData && 'route' in hoveredFlowData ? hoveredFlowData.route : null;
  const hoveredRelay = hoveredRoute ? relayPoint(hoveredRoute.from, hoveredRoute.to) : null;
  const hoveredNodeData = hoveredNode === null ? null : nodes[hoveredNode];

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;

    const findFlowIndex = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest<SVGPathElement>('.pt-login-flow-hit') : null;
      const index = target?.dataset.flowIndex;
      return index === undefined ? null : Number(index);
    };

    const showFlow = (event: Event) => {
      const index = findFlowIndex(event);
      if (index !== null && Number.isFinite(index)) {
        setHoveredFlow(index);
      }
    };

    const hideFlow = (event: Event) => {
      if (findFlowIndex(event) !== null) {
        setHoveredFlow(null);
      }
    };

    svg.addEventListener('mouseover', showFlow);
    svg.addEventListener('pointerover', showFlow);
    svg.addEventListener('mouseout', hideFlow);
    svg.addEventListener('pointerout', hideFlow);

    return () => {
      svg.removeEventListener('mouseover', showFlow);
      svg.removeEventListener('pointerover', showFlow);
      svg.removeEventListener('mouseout', hideFlow);
      svg.removeEventListener('pointerout', hideFlow);
    };
  }, []);

  return (
    <svg ref={svgRef} className="pt-login-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" role="presentation">
      <defs>
        {edges.map(([from, to], index) => (
          <path key={`path-${index}`} id={`pt-login-path-${index}`} d={pathBetween(nodes[from], nodes[to])} />
        ))}
      </defs>
      {edges.map(([from, to], index) => {
        return (
          <path
            key={`edge-${index}`}
            className={`pt-login-tie${index === 0 || index === 2 || index === 5 || index === 8 ? ' pt-login-tie--main' : ''}`}
            d={pathBetween(nodes[from], nodes[to])}
          />
        );
      })}
      {hoveredRoute && hoveredRelay
        ? relayHopPath(hoveredRoute.from, hoveredRelay, hoveredRoute.to).map((d, index) => (
          <path key={`relay-hop-${index}`} className="pt-login-relay-hop" d={d} />
        ))
        : null}
      {hoveredRoute && hoveredRelay ? <RelayMarker name={hoveredRoute.relay} x={hoveredRelay.x} y={hoveredRelay.y} /> : null}
      {nodes.map((node, index) => (
        <StationNode
          key={`station-${index}`}
          node={node}
          index={index}
          onHover={setHoveredNode}
          onLeave={() => setHoveredNode(null)}
        />
      ))}
      {hoveredNodeData ? <NodeInfoCard node={hoveredNodeData} /> : null}
      {flows.map((flow, index) => {
        const isHeld = hoveredFlow === index;
        const heldPoint = flowHoldPoint(flow);
        if (isHeld) {
          return (
            <g
              key={`flow-${flow.edge}-${flow.kind}`}
              className="pt-login-flow-chip pt-login-flow-chip--held"
              transform={`translate(${heldPoint.x} ${heldPoint.y})`}
            >
              <FlowGlyph kind={flow.kind} />
            </g>
          );
        }

        return (
          <g key={`flow-${flow.edge}-${flow.kind}`} className="pt-login-flow-chip">
            <FlowGlyph kind={flow.kind} />
            <animateMotion
              dur={flow.dur}
              begin={flow.delay}
              repeatCount="indefinite"
              rotate="auto"
              calcMode="linear"
              keyTimes="0;0.08;0.82;1"
              keyPoints={'reverse' in flow && flow.reverse ? '1;1;0;0' : '0;0;1;1'}
            >
              <mpath href={`#pt-login-path-${flow.edge}`} />
            </animateMotion>
            <animate
              attributeName="opacity"
              dur={flow.dur}
              begin={flow.delay}
              repeatCount="indefinite"
              keyTimes="0;0.08;0.82;1"
              values="0;1;1;0"
            />
          </g>
        );
      })}
      {flows.map((flow, index) => (
        <path
          key={`flow-hit-${flow.edge}`}
          className="pt-login-flow-hit"
          data-flow-index={index}
          d={pathBetween(nodes[edges[flow.edge][0]], nodes[edges[flow.edge][1]])}
        />
      ))}
    </svg>
  );
}

function NetworkBackground() {
  return (
    <div className="pt-login-bg" aria-hidden="true">
      <SvgNetworkLayer />
    </div>
  );
}

function PinView({ loading, onUnlock }: { loading: boolean; onUnlock: () => void }) {
  const [digits, setDigits] = useState(4);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (loading) return;
      if (/^[0-9]$/.test(event.key)) {
        setDigits((value) => Math.min(PIN_LENGTH, value + 1));
      } else if (event.key === 'Backspace') {
        setDigits((value) => Math.max(0, value - 1));
      } else if (event.key === 'Enter' && digits === PIN_LENGTH) {
        onUnlock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [digits, loading, onUnlock]);

  return (
    <>
      <div className="pt-login-avatar">
        <UserRound size={28} strokeWidth={1.8} />
      </div>
      <div className="pt-login-title">User B node-c</div>
      <div className="pt-login-subtitle">Enter your PIN to unlock this station.</div>
      <div className="pt-pin-row" aria-label="PIN preview">
        {Array.from({ length: PIN_LENGTH }).map((_, index) => (
          <button
            key={index}
            className="pt-pin-cell"
            data-filled={index < digits}
            onClick={() => !loading && setDigits(index + 1)}
            type="button"
          >
            {index < digits ? <span className="pt-pin-dot" /> : null}
          </button>
        ))}
      </div>
      <button className="pt-card-action" disabled={loading || digits !== PIN_LENGTH} onClick={onUnlock} type="button">
        {loading ? <Loader2 className="pt-spin" size={16} /> : <ShieldCheck size={16} />}
        {loading ? 'Unlocking locally...' : 'Unlock'}
      </button>
      <div className="pt-login-note">
        <Check size={16} />
        Loading only occupies this card. The ambient network stays on its own CSS timeline.
      </div>
    </>
  );
}

function AccountsView() {
  const accounts = [
    ['M', 'Mira', 'mira@aspen.station'],
    ['L', 'Lena', 'lena@ridge.station'],
    ['S', 'Sam', 'sam@home.station'],
  ] as const;

  return (
    <>
      <div className="pt-login-avatar">
        <ShieldCheck size={28} strokeWidth={1.8} />
      </div>
      <div className="pt-login-title">Choose a local identity</div>
      <div className="pt-login-subtitle">Resume a protected account without leaving the welcome context.</div>
      <div className="pt-account-list">
        {accounts.map(([initial, name, meta]) => (
          <div key={meta} className="pt-account-item">
            <div className="pt-mini-avatar">{initial}</div>
            <div>
              <div className="pt-account-name">{name}</div>
              <div className="pt-account-meta">{meta}</div>
            </div>
            <ChevronRight size={17} color="rgba(54, 61, 93, .38)" />
          </div>
        ))}
      </div>
    </>
  );
}

function SignInView({ loading, onUnlock }: { loading: boolean; onUnlock: () => void }) {
  return (
    <>
      <div className="pt-login-avatar">
        <Mail size={27} strokeWidth={1.8} />
      </div>
      <div className="pt-login-title">Sign in to Peers</div>
      <div className="pt-login-subtitle">Choose a provider or sign in with email.</div>
      <div className="pt-oauth-row">
        <button className="pt-oauth-btn pt-oauth-github" type="button" onClick={onUnlock} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          GitHub
        </button>
        <button className="pt-oauth-btn pt-oauth-google" type="button" onClick={onUnlock} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Google
        </button>
        <button className="pt-oauth-btn pt-oauth-wechat" type="button" onClick={onUnlock} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#07C160"><path d="M8.69 2C4.18 2 .53 4.96.53 8.62c0 2.12 1.2 4 3.07 5.22L2.9 16.4l2.86-1.43c.83.23 1.72.36 2.65.38-.07-.37-.11-.75-.11-1.14 0-3.42 3.32-6.19 7.42-6.19.26 0 .51.01.76.04C15.8 4.54 12.6 2 8.69 2zm-2.8 3.8a.96.96 0 110 1.92.96.96 0 010-1.92zm5.6 0a.96.96 0 110 1.92.96.96 0 010-1.92zm4.27 4.13c-3.5 0-6.34 2.35-6.34 5.25s2.84 5.25 6.34 5.25c.73 0 1.43-.1 2.08-.3l2.3 1.15-.62-1.93c1.58-1.05 2.58-2.62 2.58-4.17 0-2.9-2.84-5.25-6.34-5.25zm-2.1 2.93a.77.77 0 110 1.54.77.77 0 010-1.54zm4.2 0a.77.77 0 110 1.54.77.77 0 010-1.54z"/></svg>
          WeChat
        </button>
      </div>
      <div className="pt-signin-divider"><span>or</span></div>
      <div className="pt-signin-form">
        <label>
          Email
          <input defaultValue="mira@example.com" />
        </label>
        <label>
          Password
          <input defaultValue="••••••••" type="password" />
        </label>
      </div>
      <button className="pt-card-action" disabled={loading} onClick={onUnlock} type="button">
        {loading ? <Loader2 className="pt-spin" size={16} /> : <ShieldCheck size={16} />}
        {loading ? 'Signing in...' : 'Continue'}
      </button>
    </>
  );
}

export function WelcomeLoginPrototype() {
  const [mode, setMode] = useState<ViewMode>('pin');
  const [loading, setLoading] = useState(false);

  const title = useMemo(() => {
    if (mode === 'accounts') return 'Account picker prototype';
    if (mode === 'signin') return 'Re-auth prototype';
    return 'PIN unlock prototype';
  }, [mode]);

  const runLoading = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1800);
  };

  return (
    <main className="pt-login-prototype" aria-label={title}>
      <style>{css}</style>
      <NetworkBackground />
      <section className="pt-login-card">
        <div className="pt-login-card__top">
          <button className="pt-login-back" type="button">
            <ArrowLeft size={15} />
            Back
          </button>
          <div className="pt-login-modebar" aria-label="Prototype states">
            <button data-active={mode === 'pin'} onClick={() => setMode('pin')} type="button">PIN</button>
            <button data-active={mode === 'accounts'} onClick={() => setMode('accounts')} type="button">Accounts</button>
            <button data-active={mode === 'signin'} onClick={() => setMode('signin')} type="button">Sign in</button>
          </div>
        </div>
        {mode === 'pin' ? <PinView loading={loading} onUnlock={runLoading} /> : null}
        {mode === 'accounts' ? <AccountsView /> : null}
        {mode === 'signin' ? <SignInView loading={loading} onUnlock={runLoading} /> : null}
      </section>
      <div className="pt-login-status">
        <div className="pt-status-pill">
          <Server size={14} />
          10.37.246.80:18080
          <span className="pt-status-dot" />
        </div>
        <div className="pt-status-pill">
          <Globe2 size={14} />
          en
        </div>
      </div>
    </main>
  );
}
