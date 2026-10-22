import { useCallback, useEffect, useMemo, useState } from 'react';

export interface ChannelRouteDraft {
  editingId: string | null;
  chatId: string;
  chatName: string;
  agentId: string;
}

export interface ChannelAutomationDraft {
  editingId: string | null;
  triggerType: 'schedule' | 'message' | 'document';
  triggerValue: string;
  scheduleKind?: 'interval' | 'daily' | 'weekly';
  intervalMinutes?: number;
  scheduleTime?: string;
  scheduleWeekday?: number;
  scheduleTimezone?: string;
  messageMatch?: 'contains' | 'equals' | 'regex';
  messageChatId?: string;
  documentFileType?: 'doc' | 'docx' | 'sheet' | 'bitable';
  documentEvents?: string[];
  actionPrompt: string;
  agentId: string;
  destinationChatId: string;
}

export interface ChannelCreationDraft {
  name: string;
  description: string;
  region: 'feishu' | 'lark';
}

interface PersistedChannelDrafts {
  routeByBindingId: Record<string, ChannelRouteDraft>;
  automationByBindingId: Record<string, ChannelAutomationDraft>;
}

export function newChannelCreationDraft(): ChannelCreationDraft {
  return {
    name: '',
    description: '',
    region: 'feishu',
  };
}

function cloneEmptyDrafts(): PersistedChannelDrafts {
  return {
    routeByBindingId: {},
    automationByBindingId: {},
  };
}

function storageKey(actorPtid: string): string {
  return `channel:drafts:${actorPtid}`;
}

function loadDrafts(actorPtid: string | null): PersistedChannelDrafts {
  const fallback = cloneEmptyDrafts();
  if (!actorPtid) return fallback;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(actorPtid)) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      routeByBindingId: parsed.routeByBindingId ?? {},
      automationByBindingId: parsed.automationByBindingId ?? {},
    };
  } catch {
    return fallback;
  }
}

export function useChannelDrafts(actorPtid: string | null) {
  const scopeKey = actorPtid ?? '';
  const [draftsByActor, setDraftsByActor] = useState<
    Record<string, PersistedChannelDrafts>
  >(() => (actorPtid ? { [actorPtid]: loadDrafts(actorPtid) } : {}));
  const drafts = draftsByActor[scopeKey] ?? loadDrafts(actorPtid);

  const updateDrafts = useCallback((
    update: (current: PersistedChannelDrafts) => PersistedChannelDrafts,
  ) => {
    setDraftsByActor((current) => ({
      ...current,
      [scopeKey]: update(current[scopeKey] ?? loadDrafts(actorPtid)),
    }));
  }, [actorPtid, scopeKey]);

  useEffect(() => {
    if (!actorPtid) return;
    localStorage.setItem(storageKey(actorPtid), JSON.stringify(drafts));
  }, [actorPtid, drafts]);

  const setRoute = useCallback((
    bindingId: string,
    route: ChannelRouteDraft | null,
  ) => {
    updateDrafts((current) => {
      const routeByBindingId = { ...current.routeByBindingId };
      if (route) routeByBindingId[bindingId] = route;
      else delete routeByBindingId[bindingId];
      return { ...current, routeByBindingId };
    });
  }, [updateDrafts]);

  const setAutomation = useCallback((
    bindingId: string,
    automation: ChannelAutomationDraft | null,
  ) => {
    updateDrafts((current) => {
      const automationByBindingId = { ...current.automationByBindingId };
      if (automation) automationByBindingId[bindingId] = automation;
      else delete automationByBindingId[bindingId];
      return { ...current, automationByBindingId };
    });
  }, [updateDrafts]);

  return useMemo(() => ({
    routeByBindingId: drafts.routeByBindingId,
    automationByBindingId: drafts.automationByBindingId,
    setRoute,
    setAutomation,
  }), [drafts, setAutomation, setRoute]);
}
