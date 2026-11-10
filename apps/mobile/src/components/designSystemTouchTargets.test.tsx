import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Switch, UIProvider } from '@peers-touch/ui';

// The whole-product audit measures every interactive boundary against the
// 44x44 CSS px comfortable touch target on coarse pointers. These contracts
// pin the design-system touch adaptations so app surfaces cannot regress to
// undersized controls while pointer-fine layouts keep their dense geometry.
const styles = readFileSync(
  new URL(
    '../../../../packages/ui/web/src/styles.css',
    import.meta.url,
  ),
  'utf8',
);

const coarsePointerBlock = styles.match(
  /@media\(pointer:coarse\)\{(?<body>[\s\S]*?)\}\s*$/,
)?.groups?.body;

describe('design-system coarse-pointer touch targets', () => {
  it('sizes check labels on both axes to the comfortable control', () => {
    expect(coarsePointerBlock).toBeDefined();
    expect(coarsePointerBlock).toMatch(
      /\.pt-check-label\{[^}]*min-width:var\(--pt-control-comfortable\)/,
    );
    expect(coarsePointerBlock).toMatch(
      /\.pt-check-label[^{]*\{[^}]*min-height:var\(--pt-control-comfortable\)/,
    );

    const baseRule = styles.match(/\.pt-check-label\{[^}]*\}/)?.[0] ?? '';
    expect(baseRule).not.toContain('min-width');
  });

  it('grows field frames to comfortable height while pointer-fine stays normal', () => {
    expect(coarsePointerBlock).toMatch(
      /\.pt-field-frame[^{]*\{[^}]*min-height:var\(--pt-control-comfortable\)/,
    );

    const frameRule = styles.match(/\.pt-field-frame\{[^}]*\}/)?.[0] ?? '';
    expect(frameRule).toContain('min-height:var(--pt-control-normal)');
  });

  it('grows only the switch hit box while the visual track stays 36x20', () => {
    expect(coarsePointerBlock).toMatch(
      /\.pt-switch\{[^}]*width:var\(--pt-control-comfortable\)[^}]*height:var\(--pt-control-comfortable\)/,
    );

    const trackRule = styles.match(/\.pt-switch-track\{[^}]*\}/)?.[0] ?? '';
    expect(trackRule).toContain('width:36px');
    expect(trackRule).toContain('height:20px');

    const buttonRule = styles.match(/\.pt-switch\{[^}]*\}/)?.[0] ?? '';
    expect(buttonRule).toContain('background:transparent');
  });

  it('separates the switch hit target from the visual track in the DOM', () => {
    const markup = renderToStaticMarkup(
      <UIProvider theme="light">
        <Switch
          checked
          aria-label="Notifications"
          onCheckedChange={() => undefined}
        />
      </UIProvider>,
    );

    const button = markup.match(/<button[^>]*pt-switch[^>]*>/)?.[0] ?? '';
    expect(button).toContain('role="switch"');
    expect(button).toContain('aria-label="Notifications"');
    expect(markup).toContain('pt-switch-track');
    expect(markup).toContain('pt-switch-thumb');
  });
});
