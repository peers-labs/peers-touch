import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const homePageSource = fileURLToPath(new URL('./HomePage.tsx', import.meta.url));
const homeDescriptorSource = fileURLToPath(
  new URL('./HomePage.descriptor.tsx', import.meta.url),
);
const goalDraftSource = fileURLToPath(
  new URL('../components/home/GoalDraftCard.tsx', import.meta.url),
);
const goalContractSource = fileURLToPath(
  new URL('../components/home/GoalContractEditor.tsx', import.meta.url),
);

describe('HomePage Goal draft contract', () => {
  it('keeps Goal persistence in the Home runtime and exposes stable UI selectors', () => {
    const pageSource = readFileSync(homePageSource, 'utf8');
    const goalSource = readFileSync(goalDraftSource, 'utf8');
    const contractSource = readFileSync(goalContractSource, 'utf8');

    expect(pageSource).not.toContain('useEffect');
    expect(pageSource).toContain('<GoalDraftCard />');
    expect(pageSource.indexOf('<GoalDraftCard />')).toBeLessThan(
      pageSource.indexOf('{!projection && loading'),
    );
    expect(goalSource).not.toContain('useState');
    expect(goalSource).toContain('createHomeGoalDraft');
    expect(goalSource).toContain('<GoalContractEditor goal={savedGoal} />');
    for (const selector of [
      'data-pt-home-goal',
      'data-pt-home-goal-id',
      'data-pt-home-goal-readback-revision',
      'data-pt-home-goal-revision',
      'data-pt-home-goal-status',
      'data-pt-home-goal-title',
      'data-pt-home-goal-outcome',
      'data-pt-home-goal-create',
    ]) {
      expect(`${goalSource}\n${contractSource}`).toContain(selector);
    }
  });

  it('keeps Home eager and alive over the Home runtime projection', () => {
    const descriptorSource = readFileSync(homeDescriptorSource, 'utf8');

    expect(descriptorSource).toContain("id: 'home'");
    expect(descriptorSource).toContain("preload: 'eager'");
    expect(descriptorSource).toContain("keepAlive: 'forever'");
    expect(descriptorSource).toContain("runtimes: ['home']");
  });
});
