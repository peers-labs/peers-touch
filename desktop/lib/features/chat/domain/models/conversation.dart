class Conversation {
  final String id;
  final List<String> participantIds;
  final String? lastMessageId;
  final DateTime? lastMessageAt;
  final int unreadCount;
  final bool muted;
  final bool pinned;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Conversation({
    required this.id,
    required this.participantIds,
    this.lastMessageId,
    this.lastMessageAt,
    this.unreadCount = 0,
    this.muted = false,
    this.pinned = false,
    required this.createdAt,
    required this.updatedAt,
  });
}