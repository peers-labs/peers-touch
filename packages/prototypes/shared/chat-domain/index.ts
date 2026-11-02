/**
 * Headless chat domain shared by the desktop and mobile prototypes.
 *
 * No JSX, no CSS: it owns the reaction vocabulary, message-action catalog
 * and pure state operations. Each form factor keeps its own presentation
 * (hover menu/popover vs long-press bottom sheet).
 */
export * from './reactions';
export * from './operations';
export * from './actions';
