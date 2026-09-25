import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileI18nProvider } from '../../src/app/mobileI18n';
import { BoundedList, type BoundedListHandle } from '../../src/components/BoundedList';
import {
  restoreScrollPosition, saveScrollPosition,
} from '../../src/app/navigation/scrollRestoration';
import '../../src/styles.css';

// Isolated presentation fixture. No accounts, Station APIs, or Messaging Engine.
function Fixture() {
  const [surface, setSurface] = useState<'list' | 'detail'>('list');
  const [items, setItems] = useState(Array.from({ length: 1250 }, (_, index) => index));
  const [history, setHistory] = useState(false);
  const controller = useRef<BoundedListHandle>(null);
  const shell = useRef<HTMLDivElement>(null);
  const route = history ? 'history-fixture' : 'list-fixture';
  return (
    <>
      <header>
        <button onClick={() => { setHistory((value) => !value); }}>Mode</button>
        <button onClick={() => controller.current?.reveal('row-17')}>Find 17</button>
        <button onClick={() => setItems((rows) => [-1, ...rows])}>Prepend</button>
        <button onClick={() => setItems((rows) => [...rows, Math.max(...rows) + 1])}>Append</button>
        <button onClick={() => {
          saveScrollPosition(route, shell.current);
          setSurface('detail');
        }}>Detail</button>
      </header>
      <div className="mobile-content" ref={shell} style={{ height: 'calc(100dvh - 60px)' }}>
        {surface === 'list' ? (
          <div className="page-container">
            <BoundedList
              surfaceKey={route} items={items} itemKey={(row) => `row-${row}`}
              initial={history ? 'end' : 'start'} controllerRef={controller} size={100}
            >{(rows) => rows.map((row) => (
              <button
                key={row} type="button" data-scroll-anchor-id={`row-${row}`}
                data-fixture-row={row} style={{
                  display: 'block', minHeight: row % 5 === 0 ? 92 : 52, width: '100%',
                  background: 'white', border: '0.5px solid #ddd', textAlign: 'left',
                }}
              >Record {row}</button>
            ))}</BoundedList>
          </div>
        ) : (
          <button onClick={() => {
            setSurface('list');
            requestAnimationFrame(() => restoreScrollPosition(route, shell.current));
          }}>Back</button>
        )}
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <MobileI18nProvider><Fixture /></MobileI18nProvider>,
);
