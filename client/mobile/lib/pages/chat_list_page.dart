import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';
import 'package:peers_touch_mobile/components/common/floating_action_ball.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';
import 'package:peers_touch_mobile/pages/chat/chat_detail_page.dart';
import 'package:peers_touch_mobile/pages/chat/models/friend_model.dart';
import 'package:peers_touch_mobile/pages/chat/chat_friend_list_item.dart';
import 'package:peers_touch_mobile/pages/chat/chat_search_bar.dart';
import 'package:peers_touch_mobile/utils/app_localizations_helper.dart';

class ChatListPage extends StatefulWidget {
  static final List<FloatingActionOption> actionOptions = [
    FloatingActionOption(
      icon: Icons.group_add,
      tooltip: AppLocalizationsHelper.getLocalizedString(
        (l10n) => l10n.newGroup,
        'New Group',
      ),
      onPressed: () => appLogger.info('New Group pressed'),
    ),
    FloatingActionOption(
      icon: Icons.person_add,
      tooltip: AppLocalizationsHelper.getLocalizedString(
        (l10n) => l10n.addContact,
        'Add Contact',
      ),
      onPressed: () => appLogger.info('Add Contact pressed'),
    ),
  ];

  const ChatListPage({super.key});

  @override
  State<ChatListPage> createState() => _ChatListPageState();
}

class _ChatListPageState extends State<ChatListPage> {
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  final List<FriendModel> _mockFriends = [
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
      lastMessageTime:
          DateTime.now()
              .subtract(const Duration(minutes: 5))
              .millisecondsSinceEpoch,
    ),
    FriendModel(
      friendId: 'user_1002',
      avatarUrl: 'https://randomuser.me/api/portraits/women/2.jpg',
      realName: '李四',
      remarkName: '李总',
      onlineStatus: 'offline',
      lastActiveTime:
          DateTime.now()
              .subtract(const Duration(hours: 1))
              .millisecondsSinceEpoch,
      isStarred: false,
      unreadCount: 0,
      isMuted: true,
      lastMessage: '项目进展如何？',
      lastMessageTime:
          DateTime.now()
              .subtract(const Duration(hours: 2))
              .millisecondsSinceEpoch,
    ),
    FriendModel(
      friendId: 'user_1003',
      avatarUrl: 'https://randomuser.me/api/portraits/men/3.jpg',
      realName: '王五',
      remarkName: '',
      onlineStatus: 'offline',
      lastActiveTime:
          DateTime.now()
              .subtract(const Duration(days: 1))
              .millisecondsSinceEpoch,
      isStarred: false,
      unreadCount: 5,
      isMuted: false,
      lastMessage: '周末有空一起打球吗？',
      lastMessageTime:
          DateTime.now()
              .subtract(const Duration(days: 1))
              .millisecondsSinceEpoch,
    ),
  ];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<FriendModel> get _filteredFriends {
    if (_searchQuery.isEmpty) {
      return _mockFriends;
    }
    return _mockFriends.where((friend) {
      final name =
          friend.remarkName.isNotEmpty ? friend.remarkName : friend.realName;
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
    if (_filteredFriends.isEmpty) {
      return Center(child: Text(AppLocalizations.of(context)!.noContactsFound));
    }

    return ListView.builder(
      itemCount: _filteredFriends.length,
      itemBuilder: (context, index) {
        final friend = _filteredFriends[index];
        return FriendListItem(
          friend: friend,
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
        );
      },
    );
  }

  void _showFriendOptions(BuildContext context, FriendModel friend) {
    final l10n = AppLocalizations.of(context)!;

    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(12)),
      ),
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.person),
                title: Text(l10n.viewProfile),
                onTap: () {
                  Navigator.pop(context);
                  // TODO: Navigate to friend profile
                  appLogger.info('View profile for ${friend.friendId}');
                },
              ),
              ListTile(
                leading: const Icon(Icons.edit),
                title: Text(l10n.editRemark),
                onTap: () {
                  Navigator.pop(context);
                  _showEditRemarkDialog(context, friend);
                },
              ),
              ListTile(
                leading: Icon(
                  friend.isMuted
                      ? Icons.notifications
                      : Icons.notifications_off,
                ),
                title: Text(friend.isMuted ? l10n.unmute : l10n.mute),
                onTap: () {
                  Navigator.pop(context);
                  setState(() {
                    final index = _mockFriends.indexWhere(
                      (f) => f.friendId == friend.friendId,
                    );
                    if (index != -1) {
                      _mockFriends[index] = _mockFriends[index].copyWith(
                        isMuted: !friend.isMuted,
                      );
                    }
                  });
                },
              ),
              ListTile(
                leading: const Icon(Icons.delete, color: Colors.red),
                title: Text(
                  l10n.deleteFriend,
                  style: const TextStyle(color: Colors.red),
                ),
                onTap: () {
                  Navigator.pop(context);
                  _showDeleteConfirmation(context, friend);
                },
              ),
            ],
          ),
        );
      },
    );
  }

  void _showEditRemarkDialog(BuildContext context, FriendModel friend) {
    final l10n = AppLocalizations.of(context)!;
    final TextEditingController remarkController = TextEditingController(
      text: friend.remarkName,
    );

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(l10n.editRemark),
          content: TextField(
            controller: remarkController,
            decoration: InputDecoration(hintText: l10n.enterRemark),
            maxLength: 20,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(l10n.cancel),
            ),
            TextButton(
              onPressed: () {
                Navigator.pop(context);
                setState(() {
                  final index = _mockFriends.indexWhere(
                    (f) => f.friendId == friend.friendId,
                  );
                  if (index != -1) {
                    _mockFriends[index] = _mockFriends[index].copyWith(
                      remarkName: remarkController.text,
                    );
                  }
                });
              },
              child: Text(l10n.save),
            ),
          ],
        );
      },
    ).then((_) => remarkController.dispose());
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
              child: Text(l10n.cancel),
            ),
            TextButton(
              onPressed: () {
                Navigator.pop(context);
                setState(() {
                  _mockFriends.removeWhere(
                    (f) => f.friendId == friend.friendId,
                  );
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
