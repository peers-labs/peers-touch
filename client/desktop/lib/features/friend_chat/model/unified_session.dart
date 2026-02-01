/// Unified session model for both individual and group chats
/// Used to display a mixed, time-sorted conversation list

enum UnifiedSessionType { individual, group }

class UnifiedSession {
  final String id; // friend actorId or group ulid
  final UnifiedSessionType type;
  final String name;
  final String? subtitle; // username for individual, member count for group
  final String? avatarUrl;
  final List<String>? memberAvatarUrls; // for group avatar mosaic
  final String? lastMessage;
  final DateTime? lastMessageTime;
  final int unreadCount;

  // Original data references
  final dynamic originalData;

  UnifiedSession({
    required this.id,
    required this.type,
    required this.name,
    this.subtitle,
    this.avatarUrl,
    this.memberAvatarUrls,
    this.lastMessage,
    this.lastMessageTime,
    this.unreadCount = 0,
    this.originalData,
  });

  bool get isGroup => type == UnifiedSessionType.group;
  bool get isIndividual => type == UnifiedSessionType.individual;

  /// Sort by last message time (most recent first)
  static int compareByTime(UnifiedSession a, UnifiedSession b) {
    final timeA = a.lastMessageTime ?? DateTime(1970);
    final timeB = b.lastMessageTime ?? DateTime(1970);
    return timeB.compareTo(timeA); // descending order
  }
}
