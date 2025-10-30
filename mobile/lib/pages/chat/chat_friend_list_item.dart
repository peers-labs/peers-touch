import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/pages/chat/models/friend_model.dart';

class FriendListItem extends StatelessWidget {
  final FriendModel friend;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  const FriendListItem({
    super.key,
    required this.friend,
    required this.onTap,
    required this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    final displayName = friend.remarkName.isNotEmpty ? friend.remarkName : friend.realName;
    final hasUnread = friend.unreadCount > 0;
    final hasLastMessage = friend.lastMessage != null && friend.lastMessage!.isNotEmpty;
    
    return InkWell(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(color: const Color(0xFFF2F2F2), width: 1),
          ),
        ),
        child: Row(
          children: [
            // Avatar
            CircleAvatar(
              radius: 20,
              backgroundImage: friend.avatarUrl.startsWith('http')
                  ? NetworkImage(friend.avatarUrl)
                  : const AssetImage('assets/images/photo_profile_header_default.jpg') as ImageProvider,
              onBackgroundImageError: (exception, stackTrace) {
                debugPrint('Error loading avatar image: $exception');
                // Fallback to default image on error
              },
              child: friend.avatarUrl.startsWith('http')
                  ? null
                  : const Icon(Icons.person, size: 24),
            ),
            const SizedBox(width: 12),
            
            // Name and message preview
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    displayName,
                    style: TextStyle(
                      fontSize: 16,
                      color: const Color(0xFF333333),
                      fontWeight: hasUnread ? FontWeight.bold : FontWeight.normal,
                    ),
                  ),
                  if (hasLastMessage) ...[  
                    const SizedBox(height: 4),
                    Text(
                      friend.lastMessage!,
                      style: const TextStyle(fontSize: 12, color: Color(0xFF999999)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            
            // Time and unread badge
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (friend.lastMessageTime != null) ...[  
                  Text(
                    friend.getLastMessageTimeString(context),
                    style: const TextStyle(fontSize: 12, color: Color(0xFF999999)),
                  ),
                ],
                const SizedBox(height: 4),
                if (hasUnread)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: const BoxDecoration(
                      color: Color(0xFFFF3B30),
                      shape: BoxShape.circle,
                    ),
                    constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
                    child: Center(
                      child: Text(
                        friend.unreadCount > 99 ? '99+' : friend.unreadCount.toString(),
                        style: const TextStyle(fontSize: 12, color: Colors.white),
                      ),
                    ),
                  ),
                if (friend.isMuted && !hasUnread)
                  const Icon(Icons.volume_off, size: 16, color: Color(0xFF999999)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}