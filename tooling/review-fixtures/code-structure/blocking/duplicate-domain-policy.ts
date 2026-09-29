type Member = {
  role: 'owner' | 'admin' | 'member';
};

export function canDeleteFromUi(member: Member): boolean {
  return member.role === 'owner' || member.role === 'admin';
}

export function canDeleteFromGateway(member: Member): boolean {
  return member.role === 'owner';
}

export function persistenceDeleteMode(member: Member): 'hard' | 'soft' {
  return member.role === 'admin' ? 'hard' : 'soft';
}
