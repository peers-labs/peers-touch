import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regression: a label-less Checkbox (row layout where the visible name is a
// sibling and the input only carries aria-label) collapsed its .pt-check-label
// boundary to the 16px native box. The whole-product audit requires a 44x44
// CSS px touch target on coarse pointers, so the touch media rule must size
// the label itself, not only its height.
const styles = readFileSync(
  new URL(
    '../../../../packages/ui/web/src/styles.css',
    import.meta.url,
  ),
  'utf8',
);

describe('design-system check label touch target', () => {
  it('widens check labels to the comfortable control size on coarse pointers', () => {
    const mediaBlock = styles.match(
      /@media\(pointer:coarse\)\{(?<body>[\s\S]*?)\}\s*$/,
    )?.groups?.body;

    expect(mediaBlock).toBeDefined();
    expect(mediaBlock).toMatch(
      /\.pt-check-label\{[^}]*min-width:var\(--pt-control-comfortable\)/,
    );
    expect(mediaBlock).toMatch(
      /\.pt-check-label[^{]*\{[^}]*min-height:var\(--pt-control-comfortable\)/,
    );
  });

  it('keeps pointer-fine layouts free of the touch min-width', () => {
    const baseRule = styles.match(
      /\.pt-check-label\{[^}]*\}/,
    )?.[0] ?? '';

    expect(baseRule).not.toContain('min-width');
  });
});
