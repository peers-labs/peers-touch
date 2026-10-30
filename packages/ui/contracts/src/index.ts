/** Renderer-neutral intent. Business outcomes are supplied by their existing owner. */
export type ThemeMode = 'light' | 'dark' | 'system';
export type Density = 'compact' | 'normal' | 'comfortable';
export type Emphasis = 'primary' | 'secondary' | 'quiet' | 'inline';
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
/** Commands carry only neutral/danger risk (button-spec §2 orthogonal axes).
 *  success/warning/info belong to feedback surfaces, never to a command. */
export type ActionTone = 'neutral' | 'danger';
export type ActionExecution = 'idle' | 'pending' | 'succeeded' | 'failed' | 'recovering';
export type Availability = { kind: 'enabled' } | { kind: 'disabled'; reason: string };
export type ActionBehavior = 'action' | 'submit' | 'reset';
export interface ActionIntent {
  actionId: string;
  label: string;
  emphasis?: Emphasis;
  tone?: Tone;
  density?: Density;
  behavior?: ActionBehavior;
  availability?: Availability;
  execution?: ActionExecution;
}
export interface ChoiceOption<T extends string | number = string> {
  value: T;
  label: string;
  description?: string;
  availability?: Availability;
  group?: string;
}
export type SelectionMode = 'single' | 'multiple';
export type FieldValidation =
  | { state: 'valid' | 'unchecked' }
  | { state: 'invalid'; message: string };
export interface FieldContract {
  fieldId: string;
  label: string;
  description?: string;
  validation?: FieldValidation;
  required?: boolean;
  availability?: Availability;
}
export type OverlayKind = 'tooltip' | 'popover' | 'menu' | 'dialog' | 'drawer';
export type OverlayPlacement = 'top' | 'bottom' | 'left' | 'right';
export type DismissReason = 'escape' | 'outside' | 'close' | 'selection';
export interface OverlayIntent {
  overlayId: string;
  kind: OverlayKind;
  open: boolean;
  inputMode: 'pointer' | 'keyboard';
  dirty?: boolean;
  onDismiss: (reason: DismissReason) => void;
}
export interface ResourceView {
  resourceId: string;
  name: string;
  source?: string;
  state: 'available' | 'loading' | 'failed' | 'unavailable';
  failureReason?: string;
}
export interface QueryProjection<T> {
  queryId: number;
  query: string;
  state: 'idle' | 'pending' | 'ready' | 'failed';
  items: readonly T[];
  error?: string;
}
export interface MenuAction {
  id: string;
  label: string;
  description?: string;
  iconId?: string;
  tone?: Tone;
  availability?: Availability;
  onActivate: () => void;
}
export interface PlatformSupport {
  renderer: 'web' | 'lynx';
  status: 'implemented' | 'unsupported' | 'unproven';
  reason?: string;
}
export interface CapabilityRecord {
  id: string;
  title: string;
  category: string;
  owner: string;
  specRef: string;
  exports: readonly string[];
  implementationRefs: readonly string[];
  specimenRef: string | null;
  platformSupport: readonly PlatformSupport[];
  evidenceStatus: 'UNPROVEN' | 'SOURCE_CHECK' | 'FUNCTIONAL_CHECK' | 'ACCEPTANCE_PROOF';
  implementationStatus: 'PRESENTATION_IMPLEMENTED' | 'EXISTING_CONSUMER_CUTOVER';
  ownerBoundary: string;
  anatomy: string;
  statePolicy: string;
  invalidCombinations: string;
  lifecycleAndCleanup: string;
  accessibility: string;
  variantAxes: readonly string[];
  geometryAndMotion: string;
  extremeData: string;
  publicContractFields: string;
}
export { capabilityCatalogue } from './catalogue';
