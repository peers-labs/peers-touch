import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';
import 'package:peers_touch_mobile/pages/chat/chat_detail_page.dart';
import 'package:peers_touch_mobile/pages/chat/models/friend_model.dart';
import 'package:peers_touch_mobile/pages/chat/chat_search_bar.dart';

import 'chat_detail_page.dart';

class FriendsListPage extends StatefulWidget {
  const FriendsListPage({super.key});

  @override
  State<FriendsListPage> createState() => _FriendsListPageState();
}

class _FriendsListPageState extends State<FriendsListPage> {
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  
  // Mock data for all friends (including those without recent conversations)
  final List<FriendModel> _allFriends = [
    // Friends with recent conversations
    FriendModel(
      friendId: 'user_1001',
      avatarUrl: 'https://randomuser.me/api/portraits/men/1.jpg',
      realName: '张三',
      remarkName: '张总',
      onlineStatus: 'online',
      lastActiveTime: DateTime.now().millisecondsSinceEpoch,
      isStarred: true,
      unreadCount: 3,
      isMuted: false,
      lastMessage: '明天开会时间是10点',
      lastMessageTime: DateTime.now().subtract(const Duration(minutes: 5)).millisecondsSinceEpoch,
    ),
    FriendModel(
      friendId: 'user_1002',
      avatarUrl: 'https://randomuser.me/api/portraits/women/2.jpg',
      realName: '李四',
      remarkName: '李总',
      onlineStatus: 'offline',
      lastActiveTime: DateTime.now().subtract(const Duration(hours: 1)).millisecondsSinceEpoch,
      isStarred: false,
      unreadCount: 0,
      isMuted: true,
      lastMessage: '项目进展如何？',
      lastMessageTime: DateTime.now().subtract(const Duration(hours: 2)).millisecondsSinceEpoch,
    ),
    FriendModel(
      friendId: 'user_1003',
      avatarUrl: 'https://randomuser.me/api/portraits/men/3.jpg',
      realName: '王五',
      remarkName: '',
      onlineStatus: 'offline',
      lastActiveTime: DateTime.now().subtract(const Duration(days: 1)).millisecondsSinceEpoch,
      isStarred: false,
      unreadCount: 5,
      isMuted: false,
      lastMessage: '周末有空一起打球吗？',
      lastMessageTime: DateTime.now().subtract(const Duration(days: 1)).millisecondsSinceEpoch,
    ),
    // Friends without recent conversations
    FriendModel(
      friendId: 'user_1004',
      avatarUrl: 'https://randomuser.me/api/portraits/women/4.jpg',
      realName: '赵六',
      remarkName: '小赵',
      onlineStatus: 'online',
      lastActiveTime: DateTime.now().millisecondsSinceEpoch,
      isStarred: false,
      unreadCount: 0,
      isMuted: false,
      lastMessage: null,
      lastMessageTime: null,
    ),
    FriendModel(
      friendId: 'user_1005',
      avatarUrl: 'https://randomuser.me/api/portraits/men/5.jpg',
      realName: '孙七',
      remarkName: '',
      onlineStatus: 'offline',
      lastActiveTime: DateTime.now().subtract(const Duration(hours: 3)).millisecondsSinceEpoch,
      isStarred: true,
      unreadCount: 0,
      isMuted: false,
      lastMessage: null,
      lastMessageTime: null,
    ),
    FriendModel(
      friendId: 'user_1006',
      avatarUrl: 'https://randomuser.me/api/portraits/women/6.jpg',
      realName: '周八',
      remarkName: '小周',
      onlineStatus: 'offline',
      lastActiveTime: DateTime.now().subtract(const Duration(days: 2)).millisecondsSinceEpoch,
      isStarred: false,
      unreadCount: 0,
      isMuted: false,
      lastMessage: null,
      lastMessageTime: null,
    ),
    FriendModel(
      friendId: 'user_1007',
      avatarUrl: 'https://randomuser.me/api/portraits/men/7.jpg',
      realName: '吴九',
      remarkName: '',
      onlineStatus: 'online',
      lastActiveTime: DateTime.now().millisecondsSinceEpoch,
      isStarred: false,
      unreadCount: 0,
      isMuted: false,
      lastMessage: null,
      lastMessageTime: null,
    ),
  ];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<FriendModel> get _filteredFriends {
    if (_searchQuery.isEmpty) {
      return _allFriends;
    }
    return _allFriends.where((friend) {
      final name = friend.remarkName.isNotEmpty ? friend.remarkName : friend.realName;
      return name.toLowerCase().contains(_searchQuery.toLowerCase());
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return Column(
      children: [
        ChatSearchBar(
          controller: _searchController,
          onChanged: (value) {
            setState(() {
              _searchQuery = value;
            });
          },
          hintText: l10n.searchContacts,
        ),
        Expanded(child: _buildFriendsList()),
      ],
    );
  }

  Widget _buildFriendsList() {
    final l10n = AppLocalizations.of(context)!;
    
    if (_filteredFriends.isEmpty) {
      return Center(child: Text(l10n.noContactsFound));
    }

    // Group friends by online status
    final onlineFriends = _filteredFriends.where((f) => f.onlineStatus == 'online').toList();
    final offlineFriends = _filteredFriends.where((f) => f.onlineStatus != 'online').toList();

    return ListView(
      children: [
        if (onlineFriends.isNotEmpty) ...[
          _buildSectionHeader('${l10n.onlineFriends} (${onlineFriends.length})'),
          ...onlineFriends.map((friend) => _buildFriendItem(friend)),
        ],
        if (offlineFriends.isNotEmpty) ...[
          _buildSectionHeader('${l10n.offlineFriends} (${offlineFriends.length})'),
          ...offlineFriends.map((friend) => _buildFriendItem(friend)),
        ],
      ],
    );
  }

  Widget _buildSectionHeader(String title) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      color: const Color(0xFFF5F5F5),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 14,
          color: Color(0xFF666666),
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }

  Widget _buildFriendItem(FriendModel friend) {
    final displayName = friend.remarkName.isNotEmpty ? friend.remarkName : friend.realName;
    
    return InkWell(
      onTap: () {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => ChatDetailPage(friend: friend),
          ),
        );
      },
      onLongPress: () {
        _showFriendOptions(context, friend);
      },
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
        decoration: const BoxDecoration(
          border: Border(
            bottom: BorderSide(color: Color(0xFFF2F2F2), width: 1),
          ),
        ),
        child: Row(
          children: [
            // Avatar with online status indicator
            Stack(
              children: [
                CircleAvatar(
                  radius: 20,
                  backgroundImage: friend.avatarUrl.startsWith('http')
                      ? NetworkImage(friend.avatarUrl)
                      : const AssetImage('assets/images/photo_profile_header_default.jpg') as ImageProvider,
                  onBackgroundImageError: (exception, stackTrace) {
                    debugPrint('Error loading avatar image: $exception');
                  },
                  child: friend.avatarUrl.startsWith('http')
                      ? null
                      : const Icon(Icons.person, size: 24),
                ),
                if (friend.onlineStatus == 'online')
                  Positioned(
                    right: 0,
                    bottom: 0,
                    child: Container(
                      width: 12,
                      height: 12,
                      decoration: BoxDecoration(
                        color: const Color(0xFF4CAF50),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(width: 12),
            
            // Name and status
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        displayName,
                        style: const TextStyle(
                          fontSize: 16,
                          color: Color(0xFF333333),
                          fontWeight: FontWeight.normal,
                        ),
                      ),
                      if (friend.isStarred) ...[
                        const SizedBox(width: 4),
                        const Icon(
                          Icons.star,
                          size: 16,
                          color: Color(0xFFFFB300),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    friend.onlineStatus == 'online' 
                        ? '在线' 
                        : '最后活跃：${friend.getLastActiveTimeString(context)}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xFF999999),
                    ),
                  ),
                ],
              ),
            ),
            
            // Mute indicator
            if (friend.isMuted)
              const Icon(
                Icons.notifications_off,
                size: 16,
                color: Color(0xFF999999),
              ),
          ],
        ),
      ),
    );
  }

  void _showFriendOptions(BuildContext context, FriendModel friend) {
    final l10n = AppLocalizations.of(context)!;
    
    showModalBottomSheet(
      context: context,
      builder: (context) => Container(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.person),
              title: Text(l10n.viewProfile),
              onTap: () {
                Navigator.pop(context);
                appLogger.info('View profile for ${friend.getDisplayName()}');
              },
            ),
            ListTile(
              leading: const Icon(Icons.message),
              title: Text(l10n.sendMessage),
              onTap: () {
                Navigator.pop(context);
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => ChatDetailPage(friend: friend),
                  ),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.person_remove),
              title: Text(l10n.removeFriend),
              onTap: () {
                Navigator.pop(context);
                appLogger.info('Remove friend ${friend.getDisplayName()}');
              },
            ),
            ListTile(
              leading: const Icon(Icons.block),
              title: Text(l10n.blockFriend),
              onTap: () {
                Navigator.pop(context);
                appLogger.info('Block friend ${friend.getDisplayName()}');
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showEditRemarkDialog(BuildContext context, FriendModel friend) {
    final l10n = AppLocalizations.of(context)!;
    final TextEditingController remarkController = TextEditingController(text: friend.remarkName);

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(l10n.editRemark),
          content: TextField(
            controller: remarkController,
            decoration: InputDecoration(
              hintText: l10n.enterRemark,
              border: const OutlineInputBorder(),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () {
                Navigator.pop(context);
                setState(() {
                  final index = _allFriends.indexWhere((f) => f.friendId == friend.friendId);
                  if (index != -1) {
                    _allFriends[index] = _allFriends[index].copyWith(
                      remarkName: remarkController.text.trim(),
                    );
                  }
                });
              },
              child: Text(l10n.save),
            ),
          ],
        );
      },
    );
  }

  void _showDeleteConfirmation(BuildContext context, FriendModel friend) {
    final l10n = AppLocalizations.of(context)!;

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(l10n.deleteFriend),
          content: Text(l10n.deleteFriendConfirmation),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () {
                Navigator.pop(context);
                setState(() {
                  _allFriends.removeWhere((f) => f.friendId == friend.friendId);
                });
              },
              style: TextButton.styleFrom(foregroundColor: Colors.red),
              child: Text(l10n.delete),
            ),
          ],
        );
      },
    );
  }
}