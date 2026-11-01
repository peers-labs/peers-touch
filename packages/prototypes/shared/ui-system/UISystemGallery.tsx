/**
 * UISystemGallery — Frontend Eles shell.
 *
 * Six tabs, exactly the training loop of the self-improving UI/UX system:
 *   桌面原型 / 手机原型 — real product surfaces (the demand side)
 *   基础元素 — tokens + the real capability registry
 *   套件     — product-task pattern kits
 *   样本     — vetted component state matrices
 *   设计理念 — methodology and grammar
 *
 * Boards render inside a scoped UIProvider carrying the north-star candidate
 * theme (status: candidate, prototype/specimen use only). The desktop
 * prototype owns its own skin switcher and stays a separate provider tree.
 * Retired research boards (expression, foundation review, consumer breadth,
 * paper catalogue) were removed in increment 25; their conclusions live in
 * the philosophy tab and self-training-methodology.md.
 */
import { useEffect, useState } from 'react';
import { Button, UIProvider, northStarVariables } from '@peers-touch/ui';
import { DesignDirections } from './DesignDirections';
import { MobileFrame } from './MobileFrame';
import { FoundationBoard } from './FoundationBoard';
import { KitBoard } from './KitBoard';
import { SpecimenBoard, CONDITIONS, type Condition } from './SpecimenBoard';
import { PhilosophyView } from './PhilosophyView';
import './view-bar.css';
import './boards.css';

type View = 'desktop' | 'mobile' | 'elements' | 'kits' | 'specimens' | 'philosophy';
const VIEW_IDS: View[] = ['desktop', 'mobile', 'elements', 'kits', 'specimens', 'philosophy'];
const VIEWS: { id: View; label: string }[] = [
  { id: 'desktop', label: '桌面原型' },
  { id: 'mobile', label: '手机原型' },
  { id: 'elements', label: '基础元素' },
  { id: 'kits', label: '套件' },
  { id: 'specimens', label: '样本' },
  { id: 'philosophy', label: '设计理念' },
];

function initialView(): View {
  const requested = new URLSearchParams(window.location.search).get('eles');
  if (requested === 'directions' || requested === 'northstar') return 'desktop';
  if (requested === 'basics') return 'specimens';
  if ((VIEW_IDS as string[]).includes(requested ?? '')) return requested as View;
  // Retired views (consumer/catalogue/expression/foundations/old elements
  // board) fall back to the desktop prototype instead of a dead page.
  return 'desktop';
}

export function UISystemGallery() {
  const [view, setView] = useState<View>(initialView);
  const [condition, setCondition] = useState<Condition>('normal');

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('eles', view);
    window.history.replaceState(null, '', url);
  }, [view]);

  const isPrototype = view === 'desktop';

  return (
    <UIProvider theme="light" className="ui-view-provider">
      <div className="ui-view-shell" data-current-view={view}>
        <nav className="ui-view-bar" role="group" aria-label="Frontend Eles 视图切换">
          {VIEWS.map(item => (
            <Button key={item.id} actionId={`view.${item.id}`} emphasis="quiet"
              aria-pressed={view === item.id} onActivate={() => setView(item.id)}>{item.label}</Button>
          ))}
          {view === 'specimens' && (
            <span className="ui-view-bar-side" data-specimen-conditions>
              <ConditionSwitch value={condition} onChange={setCondition} />
            </span>
          )}
        </nav>
        <div className="ui-view-body">
          {view === 'desktop' ? (
            <DesignDirections />
          ) : (
            <UIProvider theme="light" className="ui-north-star-board pt-north-star"
              style={northStarVariables('light')}>
              {view === 'mobile' && <MobileFrame />}
              {view === 'elements' && <FoundationBoard />}
              {view === 'kits' && <KitBoard />}
              {view === 'specimens' && <SpecimenBoard condition={condition} />}
              {view === 'philosophy' && <PhilosophyView />}
            </UIProvider>
          )}
        </div>
      </div>
    </UIProvider>
  );
}

function ConditionSwitch({ value, onChange }: { value: Condition; onChange: (v: Condition) => void }) {
  return (
    <span role="group" aria-label="样本条件" onClick={e => e.stopPropagation()} style={{ display: 'inline-flex' }}>
      {CONDITIONS.map(opt => (
        <Button key={opt.value} actionId={`specimen.condition.${opt.value}`}
          emphasis={value === opt.value ? 'secondary' : 'quiet'}
          aria-pressed={value === opt.value}
          onActivate={() => onChange(opt.value)}>{opt.label}</Button>
      ))}
    </span>
  );
}
