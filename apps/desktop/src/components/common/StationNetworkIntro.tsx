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
  agent: string;
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

export function StationNetworkIntro({ selectedStationName, labels }: StationNetworkIntroProps) {
  return (
    <section className="pt-network-intro" aria-label={labels.title}>
      <div className="pt-network-intro__header">
        <span>{labels.title}</span>
      </div>

      <svg className="pt-network-intro__mesh" viewBox="0 0 390 548" role="img" aria-label={labels.title}>
        <defs>
          <path id="desktop-network-edge-1" d="M70 94 C104 108 132 128 166 154" />
          <path id="desktop-network-edge-2" d="M166 154 C204 104 246 88 306 108" />
          <path id="desktop-network-edge-3" d="M306 108 C332 150 340 198 322 252" />
          <path id="desktop-network-edge-4" d="M166 154 C152 214 168 272 206 326" />
          <path id="desktop-network-edge-5" d="M206 326 C160 326 118 342 82 374" />
          <path id="desktop-network-edge-6" d="M82 374 C130 430 196 452 292 432" />
          <path id="desktop-network-edge-7" d="M322 252 C314 314 306 370 292 432" />
          <path id="desktop-network-edge-8" d="M206 326 C230 378 258 408 292 432" />
          <path id="desktop-network-edge-9" d="M166 154 C226 188 270 218 322 252" />
          <path id="desktop-network-edge-10" d="M322 252 C246 284 164 324 82 374" />
          <path id="desktop-network-edge-11" d="M306 108 C326 230 322 340 292 432" />
        </defs>

        <use className="pt-network-intro__edge pt-network-intro__edge--hot" href="#desktop-network-edge-1" />
        <use className="pt-network-intro__edge" href="#desktop-network-edge-2" />
        <use className="pt-network-intro__edge pt-network-intro__edge--hot" href="#desktop-network-edge-3" />
        <use className="pt-network-intro__edge" href="#desktop-network-edge-4" />
        <use className="pt-network-intro__edge pt-network-intro__edge--hot" href="#desktop-network-edge-5" />
        <use className="pt-network-intro__edge" href="#desktop-network-edge-6" />
        <use className="pt-network-intro__edge pt-network-intro__edge--hot" href="#desktop-network-edge-7" />
        <use className="pt-network-intro__edge" href="#desktop-network-edge-8" />
        <use className="pt-network-intro__edge" href="#desktop-network-edge-9" />
        <use className="pt-network-intro__edge pt-network-intro__edge--hot" href="#desktop-network-edge-10" />
        <use className="pt-network-intro__edge" href="#desktop-network-edge-11" />

        <DataToken type="message" edgeId="desktop-network-edge-1" colorClass="pt-network-intro__data--blue" label={labels.messageFlow} duration="5.2s" />
        <DataToken type="image" edgeId="desktop-network-edge-4" colorClass="pt-network-intro__data--green" label={labels.imageFlow} duration="5.8s" begin="-1.4s" />
        <DataToken type="file" edgeId="desktop-network-edge-7" colorClass="pt-network-intro__data--amber" label={labels.fileFlow} duration="6.1s" begin="-2.1s" />
        <DataToken type="message" edgeId="desktop-network-edge-8" colorClass="pt-network-intro__data--cyan" label={labels.messageFlow} duration="5.5s" begin="-3.2s" />
        <DataToken type="task" edgeId="desktop-network-edge-10" colorClass="pt-network-intro__data--rose" label={labels.taskFlow} duration="6.8s" begin="-0.8s" />
        <DataToken type="image" edgeId="desktop-network-edge-9" colorClass="pt-network-intro__data--green" label={labels.imageFlow} duration="5.9s" begin="-4.3s" />
        <DataToken type="file" edgeId="desktop-network-edge-11" colorClass="pt-network-intro__data--amber" label={labels.fileFlow} duration="7s" begin="-2.6s" />
        <DataToken type="message" edgeId="desktop-network-edge-6" colorClass="pt-network-intro__data--blue" label={labels.messageFlow} duration="6.4s" begin="-5.1s" />

        <NetworkNode x={70} y={94} label={labels.alice} subLabel={labels.personal} />
        <NetworkNode x={166} y={154} label={labels.station} subLabel={labels.alice} />
        <NetworkNode x={306} y={108} label={labels.relay} subLabel={labels.relayLink} />
        <NetworkNode x={322} y={252} label={labels.service} subLabel={labels.station} />
        <NetworkNode x={206} y={326} label={labels.station} subLabel={labels.bob} />
        <NetworkNode x={82} y={374} label={labels.agent} subLabel={labels.station} />

        <g className="pt-network-intro__node pt-network-intro__node--selected" transform="translate(292 432)">
          <circle className="pt-network-intro__swap-flash" r="42" />
          <circle className="pt-network-intro__node-halo" r="36" />
          <rect className="pt-network-intro__node-hit" x="-52" y="-27" width="104" height="54" rx="19" />
          <text className="pt-network-intro__node-label pt-network-intro__placeholder-name" y="-3">{labels.station}</text>
          <text className="pt-network-intro__node-sub pt-network-intro__placeholder-name" y="13">{labels.joining}</text>
          <text className="pt-network-intro__node-label pt-network-intro__chosen-name" y="-3">{selectedStationName}</text>
          <text className="pt-network-intro__node-sub pt-network-intro__chosen-name" y="13">{labels.yourStation}</text>
        </g>
      </svg>
    </section>
  );
}

function NetworkNode({ x, y, label, subLabel }: { x: number; y: number; label: string; subLabel: string }) {
  return (
    <g className="pt-network-intro__node" transform={`translate(${x} ${y})`}>
      <circle className="pt-network-intro__node-halo" r="34" />
      <rect className="pt-network-intro__node-hit" x="-46" y="-24" width="92" height="48" rx="17" />
      <text className="pt-network-intro__node-label" y="-2">{label}</text>
      <text className="pt-network-intro__node-sub" y="13">{subLabel}</text>
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
      <animateMotion dur={duration} begin={begin} repeatCount="indefinite">
        <mpath href={`#${edgeId}`} />
      </animateMotion>
    </g>
  );
}
