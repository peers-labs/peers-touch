/**
 * Session-scoped local previews for the publisher's own private Moments.
 *
 * Publishing a private Moment uploads media to Secure Content, but the
 * returned projection starts in a non-ready state (GRANT_PENDING /
 * PLACEHOLDER) until the local grant/render URL is minted. The publisher
 * already holds the picked file, so showing the neutral media placeholder
 * during that exchange is a visible regression: the card should paint the
 * local file immediately and swap to the granted remote render URL once the
 * media reaches MEDIA_READY.
 *
 * Entries are indexed by postId in the SAME ORDER as the publish intent files
 * (the native layer zips intent files with planned object ids in order, and
 * the projection media array preserves that order). The registry is a
 * React-free owner; the grid subscribes via useSyncExternalStore.
 */

export interface PrivateMediaLocalPreview {
  /** convertFileSrc() URL pointing at the picked local file. */
  src: string;
  isVideo: boolean;
}

type Listener = () => void;

const MAX_POSTS = 64;
const previewsByPost = new Map<string, PrivateMediaLocalPreview[]>();
const listeners = new Set<Listener>();
// Stable reference for posts without local previews (useSyncExternalStore
// requires getSnapshot to return the same reference when nothing changed).
const EMPTY_PREVIEWS: PrivateMediaLocalPreview[] = [];

function emit() {
  for (const listener of listeners) listener();
}

export function registerPrivateMediaLocalPreviews(
  postId: string,
  previews: PrivateMediaLocalPreview[],
): void {
  const id = postId.trim();
  if (!id || previews.length === 0) return;
  // Bounded LRU: newest posts stay; an evicted post simply falls back to the
  // normal placeholder/ready behavior.
  if (previewsByPost.size >= MAX_POSTS && !previewsByPost.has(id)) {
    const oldest = previewsByPost.keys().next().value;
    if (oldest) previewsByPost.delete(oldest);
  }
  previewsByPost.set(id, previews);
  emit();
}

export function getPrivateMediaLocalPreviews(
  postId: string,
): PrivateMediaLocalPreview[] {
  return previewsByPost.get(postId.trim()) ?? EMPTY_PREVIEWS;
}

/**
 * Drop the local previews once the post no longer needs them (all media are
 * granted/ready, or the post was deleted).
 */
export function releasePrivateMediaLocalPreviews(postId: string): void {
  if (previewsByPost.delete(postId.trim())) emit();
}

/** Clear all session previews on logout / identity switch. */
export function clearPrivateMediaLocalPreviews(): void {
  if (previewsByPost.size === 0) return;
  previewsByPost.clear();
  emit();
}

export function subscribePrivateMediaLocalPreviews(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
