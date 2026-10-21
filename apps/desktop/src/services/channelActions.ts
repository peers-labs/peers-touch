import {
  api,
  type ChannelAppValidation,
  type ChannelAutomation,
  type ChannelBindingInfo,
  type ChannelHealth,
  type ChannelMemberAccess,
  type ChannelMessageDelivery,
  type ChannelProvisioningConfirmation,
  type ChannelProvisioningSnapshot,
  type ChannelProvisioningStart,
  type ChannelRequesterAuthorization,
  type ChannelRoute,
} from './desktop_api';
import {
  refreshChannelBinding,
  refreshChannelProjection,
} from '../runtimes/channelRuntime';

function requireValue<T>(value: T | undefined, errorKey: string): T {
  if (!value) throw new Error(errorKey);
  return value;
}

export function newChannelIdempotencyKey(scope: string): string {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `channel:${scope}:${id}`;
}

export const channelActions = {
  refreshBindings(reason = 'user-retry'): Promise<void> {
    return refreshChannelProjection(reason);
  },

  async createBinding(input: Parameters<typeof api.createChannelBinding>[0]): Promise<ChannelBindingInfo> {
    const response = await api.createChannelBinding(input);
    const binding = requireValue(response.binding, 'channels.binding.responseMissing');
    await refreshChannelProjection('binding-created');
    return binding;
  },

  async updateBinding(
    bindingId: string,
    input: Parameters<typeof api.updateChannelBinding>[1],
  ): Promise<ChannelBindingInfo> {
    const response = await api.updateChannelBinding(bindingId, input);
    const binding = requireValue(response.binding, 'channels.binding.responseMissing');
    await refreshChannelBinding(bindingId, 'binding-updated');
    return binding;
  },

  async deleteBinding(bindingId: string): Promise<void> {
    await api.deleteChannelBinding(bindingId);
    await refreshChannelProjection('binding-deleted');
  },

  async startBinding(bindingId: string): Promise<void> {
    await api.startChannelBinding(bindingId);
    await refreshChannelBinding(bindingId, 'binding-started');
  },

  async stopBinding(bindingId: string): Promise<void> {
    await api.stopChannelBinding(bindingId);
    await refreshChannelBinding(bindingId, 'binding-stopped');
  },

  async setDefaultBinding(bindingId: string): Promise<ChannelBindingInfo> {
    const response = await api.setDefaultChannelBinding(bindingId);
    const binding = requireValue(response.binding, 'channels.binding.responseMissing');
    await refreshChannelProjection('default-changed');
    return binding;
  },

  validateApp(
    input: Parameters<typeof api.validateChannelApp>[0],
  ): Promise<ChannelAppValidation> {
    return api.validateChannelApp(input);
  },

  async checkHealth(bindingId: string): Promise<ChannelHealth> {
    const health = await api.checkChannelHealth(bindingId);
    await refreshChannelBinding(bindingId, 'health-checked');
    return health;
  },

  async startRequesterAuthorization(
    bindingId: string,
    domains: string[],
  ): Promise<ChannelRequesterAuthorization> {
    const response = await api.startChannelRequesterAuthorization({
      bindingId,
      domains,
      idempotencyKey: newChannelIdempotencyKey(
        `requester-authorization:${bindingId}`,
      ),
    });
    const authorization = requireValue(
      response.authorization,
      'channels.requesterAuthorization.responseMissing',
    );
    await refreshChannelBinding(bindingId, 'requester-authorization-started');
    return authorization;
  },

  async refreshRequesterAuthorization(
    authorization: ChannelRequesterAuthorization,
  ): Promise<ChannelRequesterAuthorization> {
    const response = await api.refreshChannelRequesterAuthorization(
      authorization.bindingId,
      authorization.authorizationId,
      authorization.revision,
    );
    const refreshed = requireValue(
      response.authorization,
      'channels.requesterAuthorization.responseMissing',
    );
    await refreshChannelBinding(
      authorization.bindingId,
      'requester-authorization-refreshed',
    );
    return refreshed;
  },

  async revokeRequesterAuthorization(
    authorization: ChannelRequesterAuthorization,
  ): Promise<ChannelRequesterAuthorization> {
    const response = await api.revokeChannelRequesterAuthorization(
      authorization.bindingId,
      authorization.authorizationId,
      authorization.revision,
    );
    const revoked = requireValue(
      response.authorization,
      'channels.requesterAuthorization.responseMissing',
    );
    await refreshChannelBinding(
      authorization.bindingId,
      'requester-authorization-revoked',
    );
    return revoked;
  },

  async cancelRequesterAuthorization(
    authorization: ChannelRequesterAuthorization,
  ): Promise<ChannelRequesterAuthorization> {
    const response = await api.cancelChannelRequesterAuthorization(
      authorization.bindingId,
      authorization.authorizationId,
      authorization.revision,
    );
    const cancelled = requireValue(
      response.authorization,
      'channels.requesterAuthorization.responseMissing',
    );
    await refreshChannelBinding(
      authorization.bindingId,
      'requester-authorization-cancelled',
    );
    return cancelled;
  },

  async upsertRoute(
    input: Parameters<typeof api.upsertChannelRoute>[0],
  ): Promise<ChannelRoute> {
    const response = await api.upsertChannelRoute(input);
    const route = requireValue(response.route, 'channels.route.responseMissing');
    await refreshChannelBinding(input.bindingId, 'route-upserted');
    return route;
  },

  async deleteRoute(bindingId: string, routeId: string): Promise<void> {
    await api.deleteChannelRoute(bindingId, routeId);
    await refreshChannelBinding(bindingId, 'route-deleted');
  },

  async decideMemberAccess(
    bindingId: string,
    accessId: string,
    decision: 'allow' | 'deny',
  ): Promise<ChannelMemberAccess> {
    const member = await api.decideChannelMemberAccess({
      bindingId,
      accessId,
      decision,
      idempotencyKey: newChannelIdempotencyKey(`member:${accessId}:${decision}`),
    });
    await refreshChannelBinding(bindingId, 'member-decided');
    return member;
  },

  async upsertAutomation(
    input: Parameters<typeof api.upsertChannelAutomation>[0],
  ): Promise<ChannelAutomation> {
    const response = await api.upsertChannelAutomation(input);
    const automation = requireValue(
      response.automation,
      'channels.automation.responseMissing',
    );
    await refreshChannelBinding(input.bindingId, 'automation-upserted');
    return automation;
  },

  async deleteAutomation(bindingId: string, automationId: string): Promise<void> {
    await api.deleteChannelAutomation(bindingId, automationId);
    await refreshChannelBinding(bindingId, 'automation-deleted');
  },

  async runAutomation(
    bindingId: string,
    automationId: string,
  ): Promise<ChannelAutomation> {
    const response = await api.runChannelAutomation(
      bindingId,
      automationId,
      newChannelIdempotencyKey(`automation:${automationId}`),
    );
    const automation = requireValue(
      response.automation,
      'channels.automation.responseMissing',
    );
    await refreshChannelBinding(bindingId, 'automation-ran');
    return automation;
  },

  async sendMessage(
    bindingId: string,
    targetChatId: string,
    text: string,
  ): Promise<ChannelMessageDelivery> {
    const delivery = await api.sendChannelMessage(
      bindingId,
      targetChatId,
      text,
      newChannelIdempotencyKey(`delivery:${targetChatId}`),
    );
    await refreshChannelBinding(bindingId, 'message-sent');
    return delivery;
  },

  async retryDelivery(bindingId: string, deliveryId: string): Promise<void> {
    await api.retryChannelDelivery(bindingId, deliveryId);
    await refreshChannelBinding(bindingId, 'delivery-retried');
  },

  startProvisioning(
    input: Parameters<typeof api.startChannelProvisioning>[0],
  ): Promise<ChannelProvisioningStart> {
    return api.startChannelProvisioning(input);
  },

  pollProvisioning(
    sessionId: string,
    jobId: string,
  ): Promise<ChannelProvisioningSnapshot> {
    return api.pollChannelProvisioning(sessionId, jobId);
  },

  async confirmProvisioning(
    input: Parameters<typeof api.confirmChannelProvisioning>[0],
  ): Promise<ChannelProvisioningConfirmation> {
    const confirmation = await api.confirmChannelProvisioning(input);
    await refreshChannelProjection('provisioning-confirmed');
    return confirmation;
  },

  cancelProvisioning(sessionId: string, jobId: string): Promise<unknown> {
    return api.cancelChannelProvisioning(sessionId, jobId);
  },

  async exportDiagnostics(bindingId: string): Promise<void> {
    const exported = await api.exportChannelDiagnostics(bindingId);
    const bytes = Uint8Array.from(exported.jsonData);
    const blob = new Blob([bytes.buffer], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exported.fileName || `lark-diagnostics-${bindingId}.json`;
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};
