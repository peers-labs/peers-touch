import 'package:flutter/material.dart';

import '../../../l10n/app_localizations.dart';

class FriendModel {
  final String friendId;
  final String avatarUrl;
  final String realName;
  final String remarkName;
  final String onlineStatus; // 'online' or 'offline'
  final int lastActiveTime; // timestamp in milliseconds
  final bool isStarred;
  final int unreadCount;
  final bool isMuted;
  final String? lastMessage;
  final int? lastMessageTime; // timestamp in milliseconds

  const FriendModel({
    required this.friendId,
    required this.avatarUrl,
    required this.realName,
    required this.remarkName,
    required this.onlineStatus,
    required this.lastActiveTime,
    required this.isStarred,
    required this.unreadCount,
    required this.isMuted,
    this.lastMessage,
    this.lastMessageTime,
  });

  FriendModel copyWith({
    String? friendId,
    String? avatarUrl,
    String? realName,
    String? remarkName,
    String? onlineStatus,
    int? lastActiveTime,
    bool? isStarred,
    int? unreadCount,
    bool? isMuted,
    String? lastMessage,
    int? lastMessageTime,
  }) {
    return FriendModel(
      friendId: friendId ?? this.friendId,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      realName: realName ?? this.realName,
      remarkName: remarkName ?? this.remarkName,
      onlineStatus: onlineStatus ?? this.onlineStatus,
      lastActiveTime: lastActiveTime ?? this.lastActiveTime,
      isStarred: isStarred ?? this.isStarred,
      unreadCount: unreadCount ?? this.unreadCount,
      isMuted: isMuted ?? this.isMuted,
      lastMessage: lastMessage ?? this.lastMessage,
      lastMessageTime: lastMessageTime ?? this.lastMessageTime,
    );
  }

  String getDisplayName() {
    return remarkName.isNotEmpty ? remarkName : realName;
  }

  String getLastActiveTimeString(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final now = DateTime.now();
    final lastActive = DateTime.fromMillisecondsSinceEpoch(lastActiveTime);
    final difference = now.difference(lastActive);

    if (difference.inMinutes < 1) {
      return l10n.justNow;
    } else if (difference.inMinutes < 60) {
      return l10n.minutesAgo(difference.inMinutes);
    } else if (difference.inHours < 24) {
      return l10n.hoursAgo(difference.inHours);
    } else if (difference.inDays < 7) {
      return l10n.daysAgo(difference.inDays);
    } else {
      return '${lastActive.year}-${lastActive.month.toString().padLeft(2, '0')}-${lastActive.day.toString().padLeft(2, '0')}';
    }
  }

  String getLastMessageTimeString(BuildContext context) {
    if (lastMessageTime == null) return '';
    
    final l10n = AppLocalizations.of(context)!;
    final now = DateTime.now();
    final messageTime = DateTime.fromMillisecondsSinceEpoch(lastMessageTime!);
    final difference = now.difference(messageTime);

    // Same day
    if (now.year == messageTime.year && now.month == messageTime.month && now.day == messageTime.day) {
      return '${messageTime.hour.toString().padLeft(2, '0')}:${messageTime.minute.toString().padLeft(2, '0')}';
    }
    // Yesterday
    else if (now.year == messageTime.year && now.month == messageTime.month && now.day == messageTime.day + 1) {
      return l10n.yesterday;
    }
    // Within a week
    else if (difference.inDays < 7) {
      final weekday = messageTime.weekday;
      switch (weekday) {
        case 1: return l10n.monday;
        case 2: return l10n.tuesday;
        case 3: return l10n.wednesday;
        case 4: return l10n.thursday;
        case 5: return l10n.friday;
        case 6: return l10n.saturday;
        case 7: return l10n.sunday;
        default: return '';
      }
    }
    // Older messages
    else {
      return '${messageTime.month.toString().padLeft(2, '0')}-${messageTime.day.toString().padLeft(2, '0')}';
    }
  }
}