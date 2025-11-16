import 'package:get/get.dart';
import '../pages/chat/models/friend_model.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

class FriendsController extends GetxController {
  static final FriendsController _instance = FriendsController._internal();
  factory FriendsController() => _instance;
  FriendsController._internal();

  // Mock friends data - in a real app, this would come from a database or API
  final List<FriendModel> _allFriends = [
    FriendModel(
      friendId: '1',
      realName: '张三',
      remarkName: '',
      avatarUrl: 'assets/images/avatar1.png',
      lastMessage: '你好，最近怎么样？',
      lastMessageTime: DateTime.now().subtract(const Duration(minutes: 5)).millisecondsSinceEpoch,
      unreadCount: 2,
      onlineStatus: 'online',
      lastActiveTime: DateTime.now().millisecondsSinceEpoch,
      isStarred: false,
      isMuted: false,
    ),
    FriendModel(
      friendId: '2',
      realName: '李四',
      remarkName: '',
      avatarUrl: 'assets/images/avatar2.png',
      lastMessage: '明天见面吧',
      lastMessageTime: DateTime.now().subtract(const Duration(hours: 1)).millisecondsSinceEpoch,
      unreadCount: 0,
      onlineStatus: 'online',
      lastActiveTime: DateTime.now().millisecondsSinceEpoch,
      isStarred: false,
      isMuted: false,
    ),
    FriendModel(
      friendId: '3',
      realName: '王五',
      remarkName: '',
      avatarUrl: 'assets/images/avatar3.png',
      lastMessage: '收到，谢谢！',
      lastMessageTime: DateTime.now().subtract(const Duration(hours: 2)).millisecondsSinceEpoch,
      unreadCount: 1,
      onlineStatus: 'offline',
      lastActiveTime: DateTime.now().subtract(const Duration(hours: 2)).millisecondsSinceEpoch,
      isStarred: false,
      isMuted: false,
    ),
    FriendModel(
      friendId: '4',
      realName: '赵六',
      remarkName: '',
      avatarUrl: 'assets/images/avatar4.png',
      lastMessage: '好的，没问题',
      lastMessageTime: DateTime.now().subtract(const Duration(days: 1)).millisecondsSinceEpoch,
      unreadCount: 0,
      onlineStatus: 'offline',
      lastActiveTime: DateTime.now().subtract(const Duration(days: 1)).millisecondsSinceEpoch,
      isStarred: false,
      isMuted: false,
    ),
    FriendModel(
      friendId: '5',
      realName: '孙七',
      remarkName: '',
      avatarUrl: 'assets/images/avatar5.png',
      lastMessage: '周末一起出去玩吧',
      lastMessageTime: DateTime.now().subtract(const Duration(days: 2)).millisecondsSinceEpoch,
      unreadCount: 3,
      onlineStatus: 'online',
      lastActiveTime: DateTime.now().millisecondsSinceEpoch,
      isStarred: true,
      isMuted: false,
    ),
    FriendModel(
      friendId: '6',
      realName: 'Alice',
      remarkName: '',
      avatarUrl: 'assets/images/avatar6.png',
      lastMessage: 'How are you doing?',
      lastMessageTime: DateTime.now().subtract(const Duration(hours: 3)).millisecondsSinceEpoch,
      unreadCount: 0,
      onlineStatus: 'online',
      lastActiveTime: DateTime.now().millisecondsSinceEpoch,
      isStarred: false,
      isMuted: false,
    ),
    FriendModel(
      friendId: '7',
      realName: 'Bob',
      remarkName: '',
      avatarUrl: 'assets/images/avatar7.png',
      lastMessage: 'See you tomorrow!',
      lastMessageTime: DateTime.now().subtract(const Duration(hours: 4)).millisecondsSinceEpoch,
      unreadCount: 1,
      onlineStatus: 'offline',
      lastActiveTime: DateTime.now().subtract(const Duration(hours: 4)).millisecondsSinceEpoch,
      isStarred: false,
      isMuted: false,
    ),
    FriendModel(
      friendId: '8',
      realName: 'Charlie',
      remarkName: '',
      avatarUrl: 'assets/images/avatar8.png',
      lastMessage: 'Thanks for your help',
      lastMessageTime: DateTime.now().subtract(const Duration(days: 3)).millisecondsSinceEpoch,
      unreadCount: 0,
      onlineStatus: 'offline',
      lastActiveTime: DateTime.now().subtract(const Duration(days: 3)).millisecondsSinceEpoch,
      isStarred: false,
      isMuted: false,
    ),
  ];

  String _searchQuery = '';

  // Getters
  List<FriendModel> get allFriends => _allFriends;
  
  List<FriendModel> get recentConversations {
    // Return friends with recent messages (last 7 days)
    final sevenDaysAgo = DateTime.now().subtract(const Duration(days: 7)).millisecondsSinceEpoch;
    return _allFriends
        .where((friend) => friend.lastMessageTime != null && friend.lastMessageTime! > sevenDaysAgo)
        .toList()
      ..sort((a, b) => (b.lastMessageTime ?? 0).compareTo(a.lastMessageTime ?? 0));
  }

  List<FriendModel> get onlineFriends {
    return _allFriends.where((friend) => friend.onlineStatus == 'online').toList()
      ..sort((a, b) => a.getDisplayName().compareTo(b.getDisplayName()));
  }

  List<FriendModel> get offlineFriends {
    return _allFriends.where((friend) => friend.onlineStatus == 'offline').toList()
      ..sort((a, b) => a.getDisplayName().compareTo(b.getDisplayName()));
  }

  List<FriendModel> get filteredFriends {
    if (_searchQuery.isEmpty) {
      return _allFriends;
    }
    return _allFriends
        .where((friend) =>
            friend.getDisplayName().toLowerCase().contains(_searchQuery.toLowerCase()) ||
            (friend.lastMessage?.toLowerCase().contains(_searchQuery.toLowerCase()) ?? false))
        .toList();
  }

  List<FriendModel> get filteredRecentConversations {
    if (_searchQuery.isEmpty) {
      return recentConversations;
    }
    return recentConversations
        .where((friend) =>
            friend.getDisplayName().toLowerCase().contains(_searchQuery.toLowerCase()) ||
            (friend.lastMessage?.toLowerCase().contains(_searchQuery.toLowerCase()) ?? false))
        .toList();
  }

  String get searchQuery => _searchQuery;

  // Methods
  void updateSearchQuery(String query) {
    _searchQuery = query;
    update();
  }

  void clearSearch() {
    _searchQuery = '';
    update();
  }

  FriendModel? getFriendById(String id) {
    try {
      return _allFriends.firstWhere((friend) => friend.friendId == id);
    } catch (e) {
      appLogger.warning('Friend with id $id not found');
      return null;
    }
  }

  void updateFriendOnlineStatus(String friendId, String status) {
    final friendIndex = _allFriends.indexWhere((friend) => friend.friendId == friendId);
    if (friendIndex != -1) {
      _allFriends[friendIndex] = _allFriends[friendIndex].copyWith(
        onlineStatus: status,
        lastActiveTime: DateTime.now().millisecondsSinceEpoch,
      );
      update();
      appLogger.info('Updated online status for friend $friendId: $status');
    }
  }

  void updateLastMessage(String friendId, String message, int time) {
    final friendIndex = _allFriends.indexWhere((friend) => friend.friendId == friendId);
    if (friendIndex != -1) {
      _allFriends[friendIndex] = _allFriends[friendIndex].copyWith(
        lastMessage: message,
        lastMessageTime: time,
      );
      update();
      appLogger.info('Updated last message for friend $friendId');
    }
  }

  void incrementUnreadCount(String friendId) {
    final friendIndex = _allFriends.indexWhere((friend) => friend.friendId == friendId);
    if (friendIndex != -1) {
      final currentCount = _allFriends[friendIndex].unreadCount;
      _allFriends[friendIndex] = _allFriends[friendIndex].copyWith(
        unreadCount: currentCount + 1,
      );
      update();
      appLogger.info('Incremented unread count for friend $friendId');
    }
  }

  void clearUnreadCount(String friendId) {
    final friendIndex = _allFriends.indexWhere((friend) => friend.friendId == friendId);
    if (friendIndex != -1) {
      _allFriends[friendIndex] = _allFriends[friendIndex].copyWith(unreadCount: 0);
      update();
      appLogger.info('Cleared unread count for friend $friendId');
    }
  }

  void addFriend(FriendModel friend) {
    if (!_allFriends.any((f) => f.friendId == friend.friendId)) {
      _allFriends.add(friend);
      update();
      appLogger.info('Added new friend: ${friend.getDisplayName()}');
    }
  }

  void removeFriend(String friendId) {
    _allFriends.removeWhere((friend) => friend.friendId == friendId);
    update();
    appLogger.info('Removed friend with id: $friendId');
  }

  void updateFriendRemark(String friendId, String remarkName) {
    final friendIndex = _allFriends.indexWhere((friend) => friend.friendId == friendId);
    if (friendIndex != -1) {
      _allFriends[friendIndex] = _allFriends[friendIndex].copyWith(
        remarkName: remarkName,
      );
      update();
      appLogger.info('Updated remark for friend $friendId: $remarkName');
    }
  }

  void toggleMute(String friendId) {
    final friendIndex = _allFriends.indexWhere((friend) => friend.friendId == friendId);
    if (friendIndex != -1) {
      final currentMuteStatus = _allFriends[friendIndex].isMuted;
      _allFriends[friendIndex] = _allFriends[friendIndex].copyWith(
        isMuted: !currentMuteStatus,
      );
      update();
      appLogger.info('Toggled mute for friend $friendId: ${!currentMuteStatus}');
    }
  }

  @override
  void onClose() {
    // Clean up resources if needed
    super.onClose();
  }
}