// PageDescriptor for the evaluation (benchmark) page.
//
// Evaluation is an advanced tool for measuring agent quality.
// Loaded lazily since it is not part of the primary workflow.

import { registerPage } from '../kernel/page';
import { EvaluationPageContainer } from './EvaluationPageContainer';

export function registerEvaluationPage(): void {
  registerPage({
    id: 'evaluation',
    title: 'Evaluation',
    factory: () => <EvaluationPageContainer />,
    preload: 'on-visit',
    keepAlive: { lru: 1 },
    runtimes: ['evaluation', 'agent-capability'],
  });
}
