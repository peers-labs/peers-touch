import { selectGroupConversations as projectGroupStoreConversations, type GroupState } from './groupStore';

export const selectGroupConversations = (state: GroupState) => projectGroupStoreConversations(state);
