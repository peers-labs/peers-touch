import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';

/// Unified session model for both individual and group chats.
/// Used to display a mixed, time-sorted conversation list.

enum UnifiedSessionType { individual, group }

/// 最后消息类型显示文本
class LastMessageTypeDisplay {
  static String getDisplay(MessageType type) {
    switch (type) {
      case MessageType.MESSAGE_TYPE_IMAGE:
        return '[图片]';
      case MessageType.MESSAGE_TYPE_FILE:
        return '[文件]';
      case MessageType.MESSAGE_TYPE_LOCATION:
        return '[位置]';
      case MessageType.MESSAGE_TYPE_SYSTEM:
        return '[系统消息]';
      case MessageType.MESSAGE_TYPE_STICKER:
        return '[表情]';
      case MessageType.MESSAGE_TYPE_AUDIO:
        return '[语音]';
      case MessageType.MESSAGE_TYPE_VIDEO:
        return '[视频]';
      default:
        return '';
    }
  }
}

class UnifiedSession {
  final String id; // friend actorId or group ulid
  final UnifiedSessionType type;
  final String name;
  final String? subtitle; // username for individual, member count for group
  final String? avatarUrl;
  final List<String>? memberAvatarUrls; // for group avatar mosaic
  final String? lastMessage;
  final DateTime? lastMessageTime;
  final MessageType? lastMessageType;
  final int unreadCount;
  final bool isPinned;
  final bool isMuted;

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
    this.lastMessageType,
    this.unreadCount = 0,
    this.isPinned = false,
    this.isMuted = false,
    this.originalData,
  });

  bool get isGroup => type == UnifiedSessionType.group;
  bool get isIndividual => type == UnifiedSessionType.individual;

  /// 获取最后消息的展示文本
  String get lastMessageDisplay {
    if (lastMessage == null || lastMessage!.isEmpty) {
      if (lastMessageType != null && lastMessageType != MessageType.MESSAGE_TYPE_TEXT) {
        return LastMessageTypeDisplay.getDisplay(lastMessageType!);
      }
      return '';
    }
    // 如果是非文本消息，显示类型标识
    if (lastMessageType != null && lastMessageType != MessageType.MESSAGE_TYPE_TEXT) {
      return LastMessageTypeDisplay.getDisplay(lastMessageType!);
    }
    return lastMessage!;
  }

  /// Sort by pinned first, then by last message time (most recent first)
  static int compareByTime(UnifiedSession a, UnifiedSession b) {
    // 置顶优先
    if (a.isPinned != b.isPinned) {
      return a.isPinned ? -1 : 1;
    }
    final timeA = a.lastMessageTime ?? DateTime(1970);
    final timeB = b.lastMessageTime ?? DateTime(1970);
    return timeB.compareTo(timeA); // descending order
  }

  /// 复制并修改
  UnifiedSession copyWith({
    String? id,
    UnifiedSessionType? type,
    String? name,
    String? subtitle,
    String? avatarUrl,
    List<String>? memberAvatarUrls,
    String? lastMessage,
    DateTime? lastMessageTime,
    MessageType? lastMessageType,
    int? unreadCount,
    bool? isPinned,
    bool? isMuted,
    dynamic originalData,
  }) {
    return UnifiedSession(
      id: id ?? this.id,
      type: type ?? this.type,
      name: name ?? this.name,
      subtitle: subtitle ?? this.subtitle,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      memberAvatarUrls: memberAvatarUrls ?? this.memberAvatarUrls,
      lastMessage: lastMessage ?? this.lastMessage,
      lastMessageTime: lastMessageTime ?? this.lastMessageTime,
      lastMessageType: lastMessageType ?? this.lastMessageType,
      unreadCount: unreadCount ?? this.unreadCount,
      isPinned: isPinned ?? this.isPinned,
      isMuted: isMuted ?? this.isMuted,
      originalData: originalData ?? this.originalData,
    );
  }
}
