import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RadioGroup, UIProvider } from '@peers-touch/ui';

// Regression: the design-system RadioGroup used to render inputs without a
// value attribute, so every radio collapsed to the browser default "on".
// Acceptance selects a Federation by matching input[value="<federationId>"],
// which could never converge even though the directory data was present.
describe('design-system RadioGroup input value contract', () => {
  it('binds each option value onto its radio input', () => {
    const markup = renderToStaticMarkup(
      <UIProvider theme="light">
        <RadioGroup<string>
          label="Federation"
          value="fed-2"
          onValueChange={() => undefined}
          options={[
            { label: 'Federation One', value: 'fed-1' },
            { label: 'Federation Two', value: 'fed-2' },
          ]}
        />
      </UIProvider>,
    );

    expect(markup).toContain('value="fed-1"');
    expect(markup).toContain('value="fed-2"');
    expect(markup).not.toContain('value="on"');
  });

  it('coerces numeric option values to the input string contract', () => {
    const markup = renderToStaticMarkup(
      <UIProvider theme="light">
        <RadioGroup<number>
          label="Choice"
          value={2}
          onValueChange={() => undefined}
          options={[
            { label: 'One', value: 1 },
            { label: 'Two', value: 2 },
          ]}
        />
      </UIProvider>,
    );

    expect(markup).toContain('value="1"');
    expect(markup).toContain('value="2"');
  });
});
