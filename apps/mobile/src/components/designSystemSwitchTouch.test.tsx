import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Switch, UIProvider } from '@peers-touch/ui';

// Regression: the Switch button itself was the 36x20 visual pill, so the
// whole-product touch audit measured an undersized hit target. The button is
// now a transparent hit box wrapping a fixed-size visual track span.
const styles = readFileSync(
  new URL(
    '../../../../packages/ui/web/src/styles.css',
    import.meta.url,
  ),
  'utf8',
);

describe('design-system Switch touch contract', () => {
  it('separates the hit target from the visual track', () => {
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

  it('grows only the hit box on coarse pointers while the track stays 36x20', () => {
    const mediaBlock = styles.match(
      /@media\(pointer:coarse\)\{(?<body>[\s\S]*?)\}\s*$/,
    )?.groups?.body;

    expect(mediaBlock).toMatch(
      /\.pt-switch\{[^}]*width:var\(--pt-control-comfortable\)[^}]*height:var\(--pt-control-comfortable\)/,
    );

    const trackRule = styles.match(/\.pt-switch-track\{[^}]*\}/)?.[0] ?? '';
    expect(trackRule).toContain('width:36px');
    expect(trackRule).toContain('height:20px');

    const buttonRule = styles.match(/\.pt-switch\{[^}]*\}/)?.[0] ?? '';
    expect(buttonRule).toContain('background:transparent');
  });
});
