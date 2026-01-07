import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/model/domain/activity/activity.pb.dart' as pb;
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';
import 'package:peers_touch_desktop/features/discovery/model/discovery_item.dart';
import 'package:peers_touch_desktop/features/discovery/repository/discovery_repository.dart';
import 'package:peers_touch_desktop/features/shell/controller/right_panel_mode.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';

class GroupItem {
  GroupItem({required this.id, required this.name, required this.iconUrl});
  final String id;
  final String name;
  final String iconUrl;
}

class FriendItem {
  FriendItem({
    required this.id,
    required this.name,
    required this.avatarUrl,
    required this.timeOrStatus,
    this.isOnline = false,
    this.lat,
    this.lon,
  });
  final String id;
  final String name;
  final String avatarUrl;
  final String timeOrStatus;
  final bool isOnline;
  final double? lat;
  final double? lon;
}

class DiscoveryController extends GetxController {
  final items = <DiscoveryItem>[].obs;
  final groups = <GroupItem>[].obs;
  final friends = <FriendItem>[].obs;
  
  // Alias for RadarController compatibility
  RxList<FriendItem> get followingActors => friends;

  // Radar View Support
  final localStationActors = <FriendItem>[].obs;
  final searchResults = <FriendItem>[].obs;

  final selectedItem = Rx<DiscoveryItem?>(null);
  final isLoading = false.obs;
  final error = Rx<String?>(null);
  final searchQuery = ''.obs;
  final currentTab = 0.obs;

  // Track the latest request to prevent race conditions
  int _activeRequestId = 0;
  final tabs = ['Home', 'Me', 'Radar', 'Follow', 'Announce', 'Comment'];
  final tabIcons = <IconData>[
    Icons.home_filled,
    Icons.person,
    Icons.radar,
    Icons.person_add,
    Icons.campaign,
    Icons.chat_bubble,
  ];

  final scrollController = ScrollController();
  final isScrolling = false.obs;
  Timer? _scrollStopTimer;
  RightPanelMode? _previousRightPanelMode;
  
  final DiscoveryRepository _repo = Get.find<DiscoveryRepository>();

  @override
  void onInit() {
    super.onInit();
    try {
      final shell = Get.find<ShellController>();
      _previousRightPanelMode = shell.rightPanelMode.value;
      shell.rightPanelMode.value = RightPanelMode.hide;
    } catch (_) {}
    loadItems();
    loadGroups();
    loadFriends();
    
    // React to tab changes
    ever(currentTab, (_) {
      scrollToTop();
      loadItems();
    });

    scrollController.addListener(() {
      isScrolling.value = true;
      _scrollStopTimer?.cancel();
      _scrollStopTimer = Timer(const Duration(milliseconds: 180), () {
        isScrolling.value = false;
      });
    });
  }
  
  @override
  void onClose() {
    try {
      final shell = Get.find<ShellController>();
      final prev = _previousRightPanelMode;
      if (prev != null) shell.rightPanelMode.value = prev;
    } catch (_) {}
    _scrollStopTimer?.cancel();
    super.onClose();
  }

  void setTab(int index) {
    currentTab.value = index;
  }

  void loadGroups() {
    // Mock data for groups (TODO: Fetch from repo)
    groups.value = [
      GroupItem(id: '1', name: 'Figma Community', iconUrl: 'https://cdn-icons-png.flaticon.com/512/5968/5968705.png'),
      GroupItem(id: '2', name: 'Sketch Community', iconUrl: 'https://cdn-icons-png.flaticon.com/512/5968/5968746.png'),
      GroupItem(id: '3', name: 'Flutter Devs', iconUrl: 'https://cdn-icons-png.flaticon.com/512/5968/5968443.png'),
    ];
  }

  Future<void> loadFriends() async {
    try {
      final username = _getCurrentUsername();
      if (username.isEmpty) return;

      final data = await _repo.fetchFollowing(username);
      friends.value = _parseActorList(data);
    } catch (e) {
      LoggingService.error('Failed to load friends: $e');
    }
  }

  Future<void> loadAllUsers() async {
    try {
      final data = await _repo.fetchActorList();
      localStationActors.value = _parseActorList(data);
    } catch (e) {
      LoggingService.error('Failed to load all users: $e');
    }
  }

  Future<void> refreshItems() async {
    await loadItems();
  }

  void addNewItem(DiscoveryItem item) {
    items.insert(0, item);
  }

  Future<void> loadItems() async {
    final requestId = ++_activeRequestId;
    
    // Reset state for new tab
    error.value = null;
    isLoading.value = true;
    items.clear();

    LoggingService.info('DiscoveryController: Loading items for tab ${tabs[currentTab.value]} (Request ID: $requestId)');

    try {
      final List<DiscoveryItem> fetchedItems = await _fetchDataByTab(tabs[currentTab.value]);

      // Guard: Only update if this is still the active request
      if (requestId != _activeRequestId) {
        LoggingService.info('DiscoveryController: Discarding stale data for Request ID: $requestId');
        return;
      }

      items.value = fetchedItems;
    } catch (e) {
      // Guard: Only update error if this is still the active request
      if (requestId != _activeRequestId) return;

      LoggingService.error('DiscoveryController: Error loading items: $e');
      String errorMessage = 'Failed to load content';
      if (e.toString().contains('SocketException') || e.toString().contains('Connection refused')) {
        errorMessage = 'Network connection failed. Please ensure the server is running.';
      }
      error.value = errorMessage;
      
      Get.snackbar(
        'Error',
        errorMessage,
        backgroundColor: Get.theme.colorScheme.errorContainer,
        colorText: Get.theme.colorScheme.onErrorContainer,
        snackPosition: SnackPosition.BOTTOM,
        margin: const EdgeInsets.all(16),
      );
    } finally {
      if (requestId == _activeRequestId) {
        isLoading.value = false;
        scrollToTop();
      }
    }
  }

  /// 策略模式：根据 Tab 名称分发数据加载任务
  Future<List<DiscoveryItem>> _fetchDataByTab(String tabName) async {
    final username = _getCurrentUsername();
    if (username.isEmpty) return [];

    try {
      Map<String, dynamic> data;
      switch (tabName) {
        case 'Me':
          data = await _repo.fetchOutbox(username);
          break;
        case 'Home':
          data = await _repo.fetchInbox(username);
          break;
        default:
          return []; // TODO: Implement other tabs (Radar/Follow/etc)
      }
      return _parseActivityPubCollection(data, username);
    } catch (e) {
      LoggingService.error('Fetch tab $tabName failed: $e');
      rethrow;
    }
  }

  Future<void> loadComments(DiscoveryItem item) async {
    try {
      final data = await _repo.fetchObjectReplies(item.objectId);
      if (data['orderedItems'] is List) {
        final commentsList = data['orderedItems'] as List;
        final comments = <DiscoveryComment>[];
        
        for (var obj in commentsList) {
          if (obj is Map) {
            String authorName = 'Unknown';
            String authorAvatar = '';
            
            if (obj['attributedTo'] is Map) {
              final attr = obj['attributedTo'] as Map;
              authorName = attr['name']?.toString() ?? attr['preferredUsername']?.toString() ?? 'Unknown';
              if (attr['icon'] is Map) {
                authorAvatar = (attr['icon'] as Map)['url']?.toString() ?? '';
              }
            } else if (obj['attributedTo'] is String) {
              authorName = (obj['attributedTo'] as String).split('/').last;
            }
            
            comments.add(DiscoveryComment(
              id: obj['id']?.toString() ?? '',
              authorName: authorName,
              authorAvatar: authorAvatar.isNotEmpty ? authorAvatar : 'https://i.pravatar.cc/150?u=$authorName',
              content: obj['content']?.toString() ?? '',
              timestamp: DateTime.tryParse(obj['published']?.toString() ?? '') ?? DateTime.now(),
            ));
          }
        }
        
        item.comments.clear();
        item.comments.addAll(comments);
        items.refresh();
      }
    } catch (e) {
      LoggingService.error('Failed to load comments: $e');
    }
  }

  Future<void> replyToItem(DiscoveryItem parent, String content) async {
    if (content.isEmpty) return;

    try {
      // 1. Get current user info (Actor)
      String username = '';
      if (Get.isRegistered<GlobalContext>()) {
        username = Get.find<GlobalContext>().actorHandle ?? '';
      }
      if (username.isEmpty && Get.isRegistered<AuthController>()) {
        username = Get.find<AuthController>().username.value;
      }
      
      if (username.isEmpty) {
        LoggingService.warning('Reply: Username not found');
        return;
      }

      // 2. Construct ActivityInput (Proto)
      // Use objectId (not activity id) for inReplyTo
      final input = pb.ActivityInput(
        text: content,
        replyTo: parent.objectId,
        visibility: 'public',
      );

      // 3. Submit
      LoggingService.info('Submitting reply to ${parent.id}');
      await _repo.submitActivity(username, input);

      // 4. Update UI (Optimistic update)
      // Add comment to parent.comments
      final newComment = DiscoveryComment(
        id: 'temp_${DateTime.now().millisecondsSinceEpoch}',
        authorName: username,
        authorAvatar: 'https://i.pravatar.cc/150?u=$username',
        content: content,
        timestamp: DateTime.now(),
      );
      
      parent.comments.add(newComment);
      parent.commentsCount++; 
      
      // Force UI update by replacing item in the observable list
      final index = items.indexOf(parent);
      if (index != -1) {
        items.refresh();
      }

    } catch (e) {
      LoggingService.error('Reply failed: $e');
      Get.snackbar('Error', 'Failed to reply: $e');
    }
  }

  Future<void> deleteItem(DiscoveryItem item) async {
    try {
      final String username = _getCurrentUsername();
      if (username.isEmpty) return;

      // Use objectId for delete
      await _repo.deleteActivity(username, item.objectId);
      items.remove(item);
      Get.snackbar('Success', 'Post deleted');
    } catch (e) {
      LoggingService.error('Delete failed: $e');
      Get.snackbar('Error', 'Failed to delete: $e');
    }
  }

  Future<void> likeItem(DiscoveryItem item) async {
    try {
      final String username = _getCurrentUsername();
      if (username.isEmpty) return;
      
      item.isLiked = !item.isLiked;
      if (item.isLiked) {
        item.likesCount++;
      } else {
        item.likesCount = (item.likesCount - 1).clamp(0, 999999);
      }
      items.refresh();
      
      await _repo.likeActivity(username, item.objectId);
      
      Get.snackbar('Success', item.isLiked ? 'Liked post' : 'Unliked post');
    } catch (e) {
      LoggingService.error('Like failed: $e');
      item.isLiked = !item.isLiked;
      if (item.isLiked) {
        item.likesCount++;
      } else {
        item.likesCount = (item.likesCount - 1).clamp(0, 999999);
      }
      items.refresh();
      Get.snackbar('Error', 'Failed to like post');
    }
  }

  Future<void> announceItem(DiscoveryItem item) async {
    try {
      final String username = _getCurrentUsername();
      if (username.isEmpty) return;
      
      item.sharesCount++;
      items.refresh();
      
      await _repo.announceActivity(username, item.objectId);
      Get.snackbar('Success', 'Post reposted');
    } catch (e) {
      LoggingService.error('Announce failed: $e');
      item.sharesCount = (item.sharesCount - 1).clamp(0, 999999);
      items.refresh();
      Get.snackbar('Error', 'Failed to repost');
    }
  }

  String _getCurrentUsername() {
    String username = '';
    if (Get.isRegistered<GlobalContext>()) {
      username = Get.find<GlobalContext>().actorHandle ?? '';
    }
    if (username.isEmpty && Get.isRegistered<AuthController>()) {
      username = Get.find<AuthController>().username.value;
    }
    return username;
  }

  void selectItem(DiscoveryItem item) {
    selectedItem.value = item;
  }
  
  void setSearchQuery(String query) {
    searchQuery.value = query;
  }

  void scrollToTop() {
    if (!scrollController.hasClients) return;
    scrollController.animateTo(0,
        duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
  }

  void searchFriends(String query) {
    if (query.isEmpty) {
      searchResults.clear();
      return;
    }
    searchResults.value = friends.where((f) => 
      f.name.toLowerCase().contains(query.toLowerCase())
    ).toList();
  }

  Future<void> followUser(FriendItem user) async {
    try {
      final username = _getCurrentUsername();
      if (username.isEmpty) return;

      await _repo.followUser(username, user.name); // user.name is username/handle
      Get.snackbar('Success', 'Followed ${user.name}');
      
      // Refresh friends list
      loadFriends();
    } catch (e) {
      LoggingService.error('Failed to follow user: $e');
      Get.snackbar('Error', 'Failed to follow user');
    }
  }

  List<FriendItem> _parseActorList(Map<String, dynamic> data) {
    final list = <FriendItem>[];
    // Handle ActivityPub OrderedCollection or basic list
    final items = data['items'] ?? data['orderedItems'];
    if (items is List) {
      for (var item in items) {
        if (item is Map) {
          final id = item['id']?.toString() ?? '';
          final name = item['preferredUsername']?.toString() ?? item['name']?.toString() ?? 'Unknown';
          String avatarUrl = '';
          if (item['icon'] is Map) {
            avatarUrl = (item['icon'] as Map)['url']?.toString() ?? '';
          }
          
          list.add(FriendItem(
            id: id,
            name: name,
            avatarUrl: avatarUrl.isNotEmpty ? avatarUrl : 'https://i.pravatar.cc/150?u=$name',
            timeOrStatus: '', // Status not always available
            isOnline: false,
          ));
        } else if (item is String) {
           // Handle string IRI (fetch profile?)
           // For now, just show ID
           list.add(FriendItem(
             id: item,
             name: item.split('/').last,
             avatarUrl: 'https://i.pravatar.cc/150?u=$item',
             timeOrStatus: '',
           ));
        }
      }
    }
    return list;
  }

  List<DiscoveryItem> _parseActivityPubCollection(Map<String, dynamic> data, String defaultAuthor) {
    final newItems = <DiscoveryItem>[];
    if (data['orderedItems'] is List) {
        final itemsList = data['orderedItems'] as List;
        for (var item in itemsList) {
          if (item is Map) {
            String title = 'New Post';
            String content = '';
            String objectId = '';
            String author = defaultAuthor; // Default, can be overridden by attributedTo
            DateTime timestamp = DateTime.now();
            final String type = item['type']?.toString() ?? 'Create';
            
            final List<String> images = [];
            int likesCount = 0;
            int repliesCount = 0;
            int sharesCount = 0;
            String authorAvatar = '';
            
            // Handle 'Create' wrapping 'Note', or direct 'Note'
            Map? obj;
            if (type == 'Create' || type == 'Announce') {
               if (item['object'] is Map) {
                 obj = item['object'];
               }
               // Extract actor from Activity
               if (item['actor'] is String) {
                 author = (item['actor'] as String).split('/').last;
               } else if (item['actor'] is Map) {
                  // extract from map
               }
            } else {
               obj = item; // Treat item as object directly
            }

            if (obj != null) {
               objectId = obj['id']?.toString() ?? '';
               if (obj['inReplyTo'] != null && obj['inReplyTo'].toString().isNotEmpty) continue;

               content = obj['content']?.toString() ?? '';
               if (obj['summary'] != null && obj['summary'].toString().isNotEmpty) {
                 title = obj['summary'].toString();
               } else if (content.isNotEmpty) {
                 final plainText = content.replaceAll(RegExp(r'<[^>]*>'), '');
                 title = plainText.split('\n').first;
                 if (title.length > 50) title = '${title.substring(0, 50)}...';
               }
               
               if (obj['published'] != null) {
                 timestamp = DateTime.tryParse(obj['published'].toString()) ?? DateTime.now();
               }
               
               if (obj['attachment'] is List) {
                 for (var att in obj['attachment']) {
                   if (att is Map) {
                     final url = att['url']?.toString();
                     if (url != null && url.isNotEmpty) images.add(url);
                   }
                 }
               }
               
               // Stats
               if (obj['likes'] is Map) likesCount = (obj['likes']['totalItems'] as num?)?.toInt() ?? 0;
               if (obj['replies'] is Map) repliesCount = (obj['replies']['totalItems'] as num?)?.toInt() ?? 0;
               if (obj['shares'] is Map) sharesCount = (obj['shares']['totalItems'] as num?)?.toInt() ?? 0;
               
               // Author info from object (preferred)
               if (obj['attributedTo'] is Map) {
                 final attributedTo = obj['attributedTo'];
                 if (attributedTo['preferredUsername'] != null) {
                    author = attributedTo['preferredUsername'].toString();
                 } else if (attributedTo['name'] != null) {
                    author = attributedTo['name'].toString();
                 }
                 
                 if (attributedTo['icon'] is Map) {
                   authorAvatar = attributedTo['icon']['url']?.toString() ?? '';
                 }
               } else if (obj['attributedTo'] is String) {
                  // If attributedTo is string IRI, use it if we haven't set author yet or to override
                  // author = (obj['attributedTo'] as String).split('/').last;
               }
            }
            
            newItems.add(DiscoveryItem(
              id: item['id']?.toString() ?? DateTime.now().toString(),
              objectId: objectId.isNotEmpty ? objectId : (item['id']?.toString() ?? ''),
              title: title,
              content: content,
              author: author,
              authorAvatar: authorAvatar.isNotEmpty ? authorAvatar : 'https://i.pravatar.cc/150?u=$author',
              timestamp: timestamp,
              type: type,
              images: images,
              likesCount: likesCount,
              commentsCount: repliesCount,
              sharesCount: sharesCount,
              comments: [], // Comments loaded separately usually
            ));
          }
        }
      }
      return newItems;
  }
}