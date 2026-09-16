import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it } from 'vitest';

import { HomeWorkProjectionSchema } from '../gen/proto/domain/agent/home_pb';
import { useHomeStore } from './home';

describe('home projection store', () => {
  beforeEach(() => {
    useHomeStore.getState().reset();
  });

  it('does not replace an accepted projection with an older revision', () => {
    useHomeStore.getState().applyProjection(
      create(HomeWorkProjectionSchema, {
        ptid: 'ptid:actor-1',
        revision: 9n,
      }),
      {},
    );
    useHomeStore.getState().applyProjection(
      create(HomeWorkProjectionSchema, {
        ptid: 'ptid:actor-1',
        revision: 8n,
      }),
      {},
    );

    expect(useHomeStore.getState().projection?.revision).toBe(9n);
    expect(useHomeStore.getState().loading).toBe(false);
  });
});
