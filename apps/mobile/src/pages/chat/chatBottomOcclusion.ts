import {
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';

import {
  useVisualKeyboardOverlap,
  visualKeyboardOverlap,
} from '../../app/layout/useVisualKeyboardOverlap';

export { visualKeyboardOverlap };

export type ChatInputPanelState =
  | 'none'
  | 'emoji'
  | 'attachment'
  | 'emoji-attachment';

interface ChatBottomOcclusionInput {
  readonly composerHeight: number | null;
  readonly inputPanelHeight: number | null;
  readonly keyboardOverlapHeight: number;
  readonly tabBarVisible: boolean;
}

export interface ChatBottomOcclusionStyle extends CSSProperties {
  '--chat-composer-measured-height': string;
  '--chat-input-panel-measured-height': string;
  '--chat-visual-keyboard-overlap': string;
  '--chat-bottom-tab-contribution': string;
}

interface UseChatBottomOcclusionOptions {
  readonly activePanel: ChatInputPanelState;
  readonly tabBarVisible: boolean;
}

export function chatInputPanelState({
  emojiOpen,
  attachmentOpen,
}: {
  readonly emojiOpen: boolean;
  readonly attachmentOpen: boolean;
}): ChatInputPanelState {
  if (emojiOpen && attachmentOpen) return 'emoji-attachment';
  if (emojiOpen) return 'emoji';
  if (attachmentOpen) return 'attachment';
  return 'none';
}

export function createChatBottomOcclusionStyle({
  composerHeight,
  inputPanelHeight,
  keyboardOverlapHeight,
  tabBarVisible,
}: ChatBottomOcclusionInput): ChatBottomOcclusionStyle {
  return {
    '--chat-composer-measured-height': composerHeight === null
      ? 'var(--chat-composer-min-height)'
      : `${composerHeight}px`,
    '--chat-input-panel-measured-height': `${inputPanelHeight ?? 0}px`,
    '--chat-visual-keyboard-overlap': `${keyboardOverlapHeight}px`,
    '--chat-bottom-tab-contribution': tabBarVisible
      ? 'var(--tabbar-height)'
      : '0px',
  };
}

export function useChatBottomOcclusion({
  activePanel,
  tabBarVisible,
}: UseChatBottomOcclusionOptions) {
  const [composerElement, composerRef] = useState<HTMLDivElement | null>(null);
  const [inputPanelElement, inputPanelRef] = useState<HTMLDivElement | null>(null);
  const composerHeight = useObservedBlockSize(composerElement);
  const inputPanelHeight = useObservedBlockSize(inputPanelElement);
  const keyboardOverlapHeight = useVisualKeyboardOverlap();

  const style = useMemo(
    () => createChatBottomOcclusionStyle({
      composerHeight,
      inputPanelHeight,
      keyboardOverlapHeight,
      tabBarVisible,
    }),
    [
      composerHeight,
      inputPanelHeight,
      keyboardOverlapHeight,
      tabBarVisible,
    ],
  );

  return {
    activePanel,
    composerRef,
    inputPanelRef,
    keyboardOverlapHeight,
    style,
    tabBarVisible,
  } as const;
}

function useObservedBlockSize(element: HTMLElement | null): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!element) {
      setHeight(null);
      return undefined;
    }

    const update = () => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      setHeight((currentHeight) => (
        currentHeight === nextHeight ? currentHeight : nextHeight
      ));
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return height;
}
