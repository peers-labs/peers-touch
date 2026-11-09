// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { create } from '@bufbuild/protobuf';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UIProvider } from '@peers-touch/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudiencePicker } from '../../components/moments/AudiencePicker';
import {
  Audience_Kind,
  AudienceSchema,
  type Audience,
} from '../../gen/proto/domain/social/post_pb';
import {
  audienceMayReachRemote,
  isAudienceSelectionComplete,
} from '../../components/moments/audienceSelection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function audience(
  kind: Audience_Kind,
  fields: {
    target?: Audience['target'];
    actorPtids?: string[];
    baseKind?: Audience_Kind;
  } = {},
): Audience {
  return create(AudienceSchema, {
    kind,
    target: fields.target ?? { case: undefined },
    actorPtids: fields.actorPtids ?? [],
    baseKind: fields.baseKind ?? Audience_Kind.KIND_UNSPECIFIED,
  });
}

describe('federated private audience matrix', () => {
  it('accepts every complete v1 private audience shape', () => {
    const complete = [
      audience(Audience_Kind.FRIENDS),
      audience(Audience_Kind.FOLLOWERS),
      audience(Audience_Kind.CIRCLE, {
        target: { case: 'circleId', value: 42n },
      }),
      audience(Audience_Kind.GROUP, {
        target: {
          case: 'groupConversationId',
          value: 'group-conversation',
        },
      }),
      audience(Audience_Kind.CUSTOM_ALLOW, {
        actorPtids: ['ptid:bob'],
      }),
      audience(Audience_Kind.CUSTOM_DENY, {
        actorPtids: ['ptid:eve'],
        baseKind: Audience_Kind.FOLLOWERS,
      }),
    ];
    expect(complete.every(isAudienceSelectionComplete)).toBe(true);
  });

  it('rejects incomplete typed targets and custom lists', () => {
    const incomplete = [
      audience(Audience_Kind.CIRCLE),
      audience(Audience_Kind.GROUP),
      audience(Audience_Kind.CUSTOM_ALLOW),
      audience(Audience_Kind.CUSTOM_DENY, {
        actorPtids: ['ptid:eve'],
        baseKind: Audience_Kind.PUBLIC,
      }),
    ];
    expect(incomplete.every((candidate) => (
      !isAudienceSelectionComplete(candidate)
    ))).toBe(true);
  });

  it('selects remote readiness for every audience that can reach a remote actor', () => {
    const context = {
      remoteFriendPtids: new Set(['ptid:bob']),
      remoteFollowerPtids: new Set(['ptid:bob', 'ptid:eve']),
      selectedCircleMemberPtids: ['ptid:local', 'ptid:bob'],
      selectedGroupHasRemote: true,
    };
    expect(audienceMayReachRemote(
      audience(Audience_Kind.FRIENDS),
      context,
    )).toBe(true);
    expect(audienceMayReachRemote(
      audience(Audience_Kind.FOLLOWERS),
      context,
    )).toBe(true);
    expect(audienceMayReachRemote(
      audience(Audience_Kind.CIRCLE, {
        target: { case: 'circleId', value: 42n },
      }),
      context,
    )).toBe(true);
    expect(audienceMayReachRemote(
      audience(Audience_Kind.GROUP, {
        target: {
          case: 'groupConversationId',
          value: 'group-conversation',
        },
      }),
      context,
    )).toBe(true);
    expect(audienceMayReachRemote(
      audience(Audience_Kind.CUSTOM_ALLOW, {
        actorPtids: ['ptid:bob'],
      }),
      context,
    )).toBe(true);
    expect(audienceMayReachRemote(
      audience(Audience_Kind.CUSTOM_DENY, {
        actorPtids: ['ptid:eve'],
        baseKind: Audience_Kind.FOLLOWERS,
      }),
      context,
    )).toBe(true);
  });

  it('keeps a fully local Group on the generic private readiness path', () => {
    expect(audienceMayReachRemote(
      audience(Audience_Kind.GROUP, {
        target: {
          case: 'groupConversationId',
          value: 'local-group',
        },
      }),
      {
        remoteFriendPtids: new Set(),
        remoteFollowerPtids: new Set(),
        selectedCircleMemberPtids: [],
        selectedGroupHasRemote: false,
      },
    )).toBe(false);
  });

  it('keeps candidate data in the owning runtimes', () => {
    const descriptor = readFileSync(
      new NodeURL('./MomentsApp.descriptor.tsx', import.meta.url),
      'utf8',
    );
    const socialRuntime = readFileSync(
      new NodeURL('../../services/socialRealtime.ts', import.meta.url),
      'utf8',
    );
    const relationshipsStore = readFileSync(
      new NodeURL('../../store/relationships.ts', import.meta.url),
      'utf8',
    );

    expect(descriptor).toContain("runtimes: ['moments', 'social', 'messaging']");
    expect(socialRuntime).toContain(
      'loadMutualFriends(actorPtid, refresh)',
    );
    expect(relationshipsStore).toContain('[normalizedActorPtid]: {');
    expect(relationshipsStore).toContain('generation !== relationshipsGeneration');
  });
});

describe('rendered private audience selection', () => {
  let host: HTMLDivElement;
  let root: Root;
  let selected: Audience;
  const changed = vi.fn();
  const candidates = {
    circles: [{ id: '42', label: 'Close friends' }],
    groups: [{ conversationId: 'group-conversation', label: 'Reading group' }],
    people: [{ actorPtid: 'ptid:bob', label: 'Bob' }, { actorPtid: 'ptid:eve', label: 'Eve' }],
  };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => ({
      matches: false, addEventListener: () => {}, removeEventListener: () => {},
    }));
    // jsdom has no layout observer; these cases assert selection, not geometry.
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    changed.mockReset();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function render(props = {}) {
    await act(async () => root.render(createElement(UIProvider, null,
      createElement(AudiencePicker, {
        ...candidates, ...props, value: selected,
        onChange: (next: Audience) => { selected = next; changed(next); },
      }))));
  }
  async function choose(marker: string, label: string) {
    const trigger = host.querySelector<HTMLButtonElement>(`[${marker}] [role="combobox"]`)!;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('aria-label')).toBeTruthy();
    await act(async () => trigger.click());
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find(node => node.textContent === label)!;
    expect(option).not.toBeUndefined();
    await act(async () => option.click());
    await render();
  }

  it.each([
    { kind: Audience_Kind.CIRCLE, key: 'circle', label: 'Close friends',
      target: { case: 'circleId' as const, value: 42n } },
    { kind: Audience_Kind.GROUP, key: 'group', label: 'Reading group',
      target: { case: 'groupConversationId' as const, value: 'group-conversation' } },
  ])('retains typed $key selection through the shared controls', async ({ kind, key, label, target }) => {
    selected = audience(Audience_Kind.PUBLIC);
    await render();
    await choose('data-moments-audience-kind', `moments.audience.${key}`);
    expect(selected.kind).toBe(kind);
    expect(isAudienceSelectionComplete(selected)).toBe(false);
    await choose('data-moments-audience-target', label);
    expect(selected.target).toEqual(target);
    expect(isAudienceSelectionComplete(selected)).toBe(true);
    expect(host.querySelector('[data-moments-audience-target]')?.textContent).toContain(label);
  });

  it.each([Audience_Kind.CUSTOM_ALLOW, Audience_Kind.CUSTOM_DENY])(
    'retains custom audience actors and denial base for kind %s', async kind => {
      selected = audience(kind, {
        baseKind: kind === Audience_Kind.CUSTOM_DENY ? Audience_Kind.FOLLOWERS : undefined,
      });
      await render();
      const actor = host.querySelector<HTMLButtonElement>('[data-moments-audience-actors] [data-actor-id="ptid:bob"]')!;
      expect(actor.getAttribute('aria-pressed')).toBe('false');
      await act(async () => actor.click());
      await render();
      expect(selected.actorPtids).toEqual(['ptid:bob']);
      expect(selected.baseKind).toBe(kind === Audience_Kind.CUSTOM_DENY
        ? Audience_Kind.FOLLOWERS : Audience_Kind.KIND_UNSPECIFIED);
      expect(isAudienceSelectionComplete(selected)).toBe(true);
      expect(actor.getAttribute('aria-pressed')).toBe('true');
      await act(async () => actor.click());
      await render();
      expect(selected.actorPtids).toEqual([]);
      expect(isAudienceSelectionComplete(selected)).toBe(false);
    },
  );

  it('keeps unavailable targets incomplete and disabled selection unchanged', async () => {
    selected = audience(Audience_Kind.CIRCLE);
    await render({ circles: [] });
    expect(host.textContent).toContain('moments.placeholder.circleEmpty');
    expect(host.querySelector('[data-moments-audience-target]')).toBeNull();
    expect(isAudienceSelectionComplete(selected)).toBe(false);
    selected = audience(Audience_Kind.CUSTOM_ALLOW, { actorPtids: ['ptid:bob'] });
    await render({ disabled: true });
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.every(button => button.matches(':disabled')
      || button.getAttribute('aria-disabled') === 'true')).toBe(true);
    await act(async () => { buttons.forEach(button => button.click()); });
    expect(changed).not.toHaveBeenCalled();
    expect(selected.actorPtids).toEqual(['ptid:bob']);
  });
});
