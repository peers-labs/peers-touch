type Member = {
  id: string;
  displayName: string;
};

type Conversation = {
  id: string;
  title: string;
};

export function memberLabel(member: Member): string {
  return member.displayName.trim() || member.id;
}

export function memberSortKey(member: Member): string {
  return `${memberLabel(member).toLocaleLowerCase()}:${member.id}`;
}

export function conversationLabel(conversation: Conversation): string {
  return conversation.title.trim() || conversation.id;
}

export function conversationSortKey(conversation: Conversation): string {
  return `${conversationLabel(conversation).toLocaleLowerCase()}:${conversation.id}`;
}
