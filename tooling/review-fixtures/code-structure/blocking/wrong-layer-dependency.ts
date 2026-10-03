import { stationHttpClient } from '../../../../apps/desktop/src/services/http';

export class MembershipPolicy {
  async canRemove(actorId: string, memberId: string): Promise<boolean> {
    const response = await stationHttpClient.get(
      `/memberships/${actorId}/${memberId}`,
    );
    return response.actorRole === 'owner' && response.memberRole !== 'owner';
  }
}
