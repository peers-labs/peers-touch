/**
 * Visual viewport tracking for touch keyboards.
 *
 * dvh already tracks the mobile URL-bar collapse, but the on-screen keyboard
 * shrinks the visual viewport without resizing layout in several webviews.
 * We publish the covered height as `--mp-keyboard-height` on the root so
 * composers and bottom sheets can sit above the keyboard.
 */
export function initVisualViewport(): () => void {
  if (typeof window === 'undefined' || !window.visualViewport) return () => {};

  const root = document.documentElement;
  const update = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--mp-keyboard-height', `${Math.round(covered)}px`);
    root.style.setProperty('--mp-vv-height', `${Math.round(vv.height)}px`);
  };

  update();
  window.visualViewport.addEventListener('resize', update);
  window.visualViewport.addEventListener('scroll', update);
  return () => {
    window.visualViewport?.removeEventListener('resize', update);
    window.visualViewport?.removeEventListener('scroll', update);
  };
}
