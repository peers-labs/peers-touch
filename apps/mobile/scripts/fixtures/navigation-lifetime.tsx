import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileNavigationHost } from '../../src/components/MobileNavigationHost';
import { useMobilePageDisposal } from '../../src/components/mobilePageLifetime';
import '../../src/styles.css';

type Observation = { allocations: number; subscriptions: number; disposals: number };
const observations: Record<string, Observation> = {};
const samples: { page: string; top: number; draft: string }[] = [];
Object.assign(window, { navigationLifetimeFixture: { observations, samples } });

function Page({ name }: { name: string }) {
  const [draft, setDraft] = useState('');
  useState(() => {
    observations[name] ??= { allocations: 0, subscriptions: 0, disposals: 0 };
    observations[name].allocations += 1;
    return name;
  });
  useEffect(() => {
    observations[name].subscriptions += 1;
    return () => { observations[name].subscriptions -= 1; };
  }, [name]);
  useMobilePageDisposal(() => { observations[name].disposals += 1; });
  return <div className="page-container" data-test-page={name} style={{ height: '100%', overflow: 'auto' }}>
    <label>{name} draft<input aria-label={`${name} draft`} data-focus-id={`${name}.draft`} value={draft}
      onChange={event => setDraft(event.target.value)} /></label>
    {Array.from({ length: 60 }, (_, index) => <p key={index} style={{ minHeight: 32, flexShrink: 0 }}>{name} row {index}</p>)}
  </div>;
}

function PrimaryA({ pane }: { pane: string }) {
  return <div style={{ height: '100%' }}>
    <header data-test-header>A header</header>
    <div style={{ height: 'calc(100% - 24px)' }}>
      <MobileNavigationHost primary={{ key: `A:leaf:${pane}`, content: <Page name={pane} /> }} />
    </div>
  </div>;
}

function Fixture() {
  const [tab, setTab] = useState('A');
  const [pane, setPane] = useState('A');
  const [details, setDetails] = useState<number[]>([]);
  const [nextDetail, setNextDetail] = useState(1);
  const [identity, setIdentity] = useState(0);
  const sampleFirstPaint = () => requestAnimationFrame(() => {
    const page = Array.from(document.querySelectorAll<HTMLElement>('[data-test-page]'))
      .find(node => !node.closest('[hidden]') && node.getClientRects().length > 0);
    if (page) samples.push({
      page: page.dataset.testPage!, top: page.scrollTop,
      draft: page.querySelector('input')?.value ?? '',
    });
  });
  return <>
    <nav onClickCapture={sampleFirstPaint}>
      {['A', 'B', 'C'].map(name => <button key={name}
        onClick={() => { setDetails([]); setTab(name); }}>Tab {name}</button>)}
      {['A', 'A2'].map(name => <button key={name}
        onClick={() => setPane(name)}>Pane {name}</button>)}
      <button onClick={() => { setDetails([...details, nextDetail]); setNextDetail(nextDetail + 1); }}>Push</button>
      <button onClick={() => setDetails(details.slice(0, -1))}>Back</button>
      <button onClick={() => setIdentity(identity + 1)}>Replace identity</button>
    </nav>
    <div style={{ height: 540 }}>
      <MobileNavigationHost key={identity}
        primary={{ key: tab, locationKey: tab === 'A' ? `A:${pane}` : tab,
          content: tab === 'A' ? <PrimaryA pane={pane} /> : <Page name={tab} /> }}
        details={details.map(id => ({ key: `detail:${id}`, content: <Page name={`D${id}`} /> }))} />
    </div>
  </>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
