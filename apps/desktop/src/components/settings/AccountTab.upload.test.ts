import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AccountTab.tsx', import.meta.url), 'utf8');

// Contract tests for the profile image upload interaction:
// immediate optimistic preview, real byte-driven reveal, authoritative
// commit, and explicit rollback. See docs/client/common/ui-identity/interaction.md
// §4 (optimistic UI needs clear recovery).
describe('AccountTab optimistic image upload', () => {
  it('subscribes to the Rust byte-progress event and unlistens on teardown', () => {
    expect(source).toContain("PROFILE_IMAGE_UPLOAD_PROGRESS_EVENT = 'profile-image-upload-progress'");
    expect(source).toContain('listen<{ field: ProfileImageField; sent: number; total: number }>');
    expect(source).toContain('unlisten?.()');
  });

  it('reveals the local preview immediately from the picked path, before upload resolves', () => {
    expect(source).toContain('beginPendingImage');
    expect(source).toContain('convertFileSrc(path)');
    // optimistic state is set right after picking, before the awaited upload.
    expect(source).toMatch(/beginPendingImage\('avatar', path\)[\s\S]*await api\.profileUploadAvatarOss/);
    expect(source).toMatch(/beginPendingImage\('header', path\)[\s\S]*await api\.profileUploadHeaderOss/);
  });

  it('drives crispness from real progress, with a blurred bottom-up reveal', () => {
    expect(source).toContain("const fraction = total > 0 ? Math.min(1, sent / total) : 0;");
    expect(source).toContain("filter: 'blur(10px) saturate(0.9)'");
    expect(source).toContain('clipPath: `inset(${((1 - fraction) * 100).toFixed(2)}% 0 0 0)`');
  });

  it('does not depend on animation to communicate state (reduced motion + a11y)', () => {
    expect(source).toContain('usePrefersReducedMotion');
    expect(source).toContain('role="progressbar"');
    expect(source).toContain('aria-valuenow={percent}');
    expect(source).toContain('role="status"');
    expect(source).toContain('provider.account.avatarHeader.uploadingProgress');
  });

  it('commits only after the authoritative image is ready and rolls back any non-commit', () => {
    // avatar: warm the local cache + identity sync before swapping the preview.
    expect(source).toContain('await api.avatarResolveLocal(next.avatar)');
    expect(source).toContain('await syncCurrentProfileIdentity(next.avatar)');
    // header: preload committed URL before removing the optimistic preview.
    expect(source).toContain('await preloadImage(next.header');
    // both flows clear pending only on commit, and roll back otherwise.
    expect(source).toContain('if (!committed) clearPendingImage(\'avatar\')');
    expect(source).toContain('if (!committed) clearPendingImage(\'header\')');
  });
});
