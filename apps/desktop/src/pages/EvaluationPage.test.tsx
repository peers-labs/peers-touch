import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetPageRegistryForTests,
  getPage,
} from '../kernel/page';
import { registerEvaluationPage } from './EvaluationPage.descriptor';

const sourcePaths = [
  './EvaluationPage.tsx',
  './evaluation/DefinitionsPanel.tsx',
  './evaluation/RunList.tsx',
  './evaluation/RunDetail.tsx',
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

describe('EvaluationPage contract', () => {
  afterEach(() => {
    _resetPageRegistryForTests();
  });

  it('is a pure renderer with the stable Evaluation action selectors', () => {
    const [pageSource, ...panelSources] = sourcePaths.map(
      (path) => readFileSync(path, 'utf8'),
    );
    const source = [pageSource, ...panelSources].join('\n');

    expect(pageSource).not.toContain('useEffect');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('quickCompletion');
    for (const selector of [
      'data-pt-evaluation-page',
      'data-pt-evaluation-tab',
      'data-pt-evaluation-create-run',
      'data-pt-evaluation-target-agent',
      'data-pt-evaluation-dataset',
      'data-pt-evaluation-create-run-submit',
      'data-pt-evaluation-run',
      'data-pt-evaluation-open-run',
      'data-pt-evaluation-start-run',
      'data-pt-evaluation-cancel-run',
      'data-pt-evaluation-retry-run',
      'data-pt-evaluation-result',
      'data-pt-evaluation-back-to-runs',
      'data-pt-evaluation-delete-run',
    ]) {
      expect(source).toContain(selector);
    }
  });

  it('registers an on-visit LRU page backed by Evaluation authority', () => {
    registerEvaluationPage();

    expect(getPage('evaluation')).toMatchObject({
      id: 'evaluation',
      preload: 'on-visit',
      keepAlive: { lru: 1 },
      runtimes: ['evaluation', 'agent-capability'],
    });
  });
});
