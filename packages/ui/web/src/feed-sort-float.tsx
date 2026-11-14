import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { geometry } from '@peers-touch/ui-tokens';
import { Button } from './actions';
import { Icon } from './icon';
import { Segmented } from './selection';
import './moments.css';

export type FeedSort = 'recent' | 'hot';
export interface FeedSortFloatProps {
  value: FeedSort; onChange: (value: FeedSort) => void;
  scrollRef: RefObject<HTMLElement | null>;
  copy: { label: string; recent: string; hot: string; top: string };
}
/** Scroll listener and width measurement belong to this presentation, never the app. */
export function FeedSortFloat({ value, onChange, scrollRef, copy }: FeedSortFloatProps) {
  const pillRef = useRef<HTMLDivElement>(null), stageRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const sync = () => { frame = 0; setAtTop(scroller.scrollTop <= geometry.social.feedTopThreshold); };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(sync); };
    sync();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); scroller.removeEventListener('scroll', onScroll); };
  }, [scrollRef]);
  useLayoutEffect(() => {
    const pill = pillRef.current, stage = stageRef.current;
    if (!pill || !stage) return;
    const measure = () => pill.style.setProperty('--sk-feed-pill-w',
      `${stage.offsetWidth + geometry.social.feedPillInset * 2}px`);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(stage);
    const frame = requestAnimationFrame(() => { pill.dataset.morphReady = 'true'; });
    return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, []);
  return <div className="sk-feed-sort-float" data-feed-sort data-feed-mode={atTop ? 'sort' : 'top'}>
    <div className="sk-feed-sort-pill" ref={pillRef} data-mode={atTop ? 'sort' : 'top'} data-morph-ready="false">
      <div className="sk-feed-sort-stage" ref={stageRef}>
        <Segmented<FeedSort> className="sk-feed-sort-options" label={copy.label} density="compact"
          value={value} options={[{ value: 'recent', label: copy.recent }, { value: 'hot', label: copy.hot }]}
          onValueChange={next => onChange(next ?? 'recent')} />
        <Button actionId="feed.back-to-top" emphasis="quiet" density="compact"
          className="sk-feed-sort-top" aria-label={copy.top}
          onActivate={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Icon iconId="arrow-up" size={15} />
        </Button>
      </div>
    </div>
  </div>;
}
