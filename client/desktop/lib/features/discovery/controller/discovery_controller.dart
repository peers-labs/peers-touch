import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/model/domain/social/post.pb.dart';
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
    this.actorId,
    this.isOnline = false,
    this.isFollowing = false,
    this.lat,
    this.lon,
  });
  final String id;
  final String name;
  final String avatarUrl;
  final String timeOrStatus;
  final String? actorId;
  final bool isOnline;
  final bool isFollowing;
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
  final isLoadingActors = false.obs;
  final error = Rx<String?>(null);
  final searchQuery = ''.obs;
  final currentTab = 0.obs;

  // Track the latest request to prevent race conditions
  int _activeRequestId = 0;
  final tabs = ['Home', 'Me', 'Radar'];
  final tabIcons = <IconData>[
    Icons.home_filled,
    Icons.person,
    Icons.radar,
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
    loadAllUsers(); // Load local station actors for Radar view
    
    // React to tab changes
    ever(currentTab, (index) {
      scrollToTop();
      if (tabs[index] == 'Radar') {
        loadAllUsers();
      } else {
        loadItems();
      }
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
      isLoadingActors.value = true;
      final response = await _repo.fetchActorList();
      LoggingService.debug('loadAllUsers: Raw response: $response');
      
      final data = response['data'] ?? response;
      LoggingService.debug('loadAllUsers: Extracted data: $data');
      
      localStationActors.value = _parseActorList(data);
      LoggingService.info('loadAllUsers: Loaded ${localStationActors.length} actors');
    } catch (e) {
      LoggingService.error('Failed to load all users: $e');
    } finally {
      isLoadingActors.value = false;
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
    LoggingService.info('=== Fetching data for tab: $tabName ===');
    
    final username = _getCurrentUsername();
    LoggingService.debug('Current username: $username');
    if (username.isEmpty) {
      LoggingService.warning('Username is empty, returning empty list');
      return [];
    }

    try {
      switch (tabName) {
        case 'Me':
          LoggingService.info('Fetching user posts for Me tab');
          final userId = _getCurrentUserId();
          if (userId.isEmpty) {
            LoggingService.error('User ID not found, cannot fetch user posts');
            return [];
          }
          LoggingService.info('Calling fetchUserPosts with userId: $userId');
          final userPostsResponse = await _repo.fetchUserPosts(userId);
          LoggingService.info('Got ${userPostsResponse.posts.length} posts from API');
          return _convertPostsToDiscoveryItems(userPostsResponse.posts);
          
        case 'Home':
          LoggingService.info('Fetching timeline for Home tab');
          final timelineResponse = await _repo.fetchTimeline(type: TimelineType.TIMELINE_PUBLIC);
          LoggingService.info('Got ${timelineResponse.posts.length} posts from timeline API');
          return _convertPostsToDiscoveryItems(timelineResponse.posts);
          
        default:
          LoggingService.warning('Unknown tab: $tabName');
          return [];
      }
    } catch (e, stackTrace) {
      LoggingService.error('Fetch tab $tabName failed: $e');
      LoggingService.debug('Stack trace: $stackTrace');
      rethrow;
    }
  }

  String _getCurrentUserId() {
    LoggingService.debug('=== _getCurrentUserId called ===');
    
    if (!Get.isRegistered<GlobalContext>()) {
      LoggingService.error('GlobalContext is NOT registered!');
      return '';
    }
    
    final context = Get.find<GlobalContext>();
    LoggingService.debug('GlobalContext found');
    LoggingService.debug('actorId: ${context.actorId}');
    LoggingService.debug('actorHandle: ${context.actorHandle}');
    LoggingService.debug('currentSession: ${context.currentSession}');
    
    String userId = context.actorId ?? '';
    if (userId.isEmpty) {
      LoggingService.error('Actor ID is EMPTY in GlobalContext!');
      LoggingService.debug('Trying to get from session directly...');
      if (context.currentSession != null) {
        userId = context.currentSession!['actorId']?.toString() ?? 
                 context.currentSession!['userId']?.toString() ?? '';
        LoggingService.debug('Got userId from session: $userId');
      }
    } else {
      LoggingService.info('Got valid userId: $userId');
    }
    
    return userId;
  }

  List<DiscoveryItem> _convertPostsToDiscoveryItems(List<Post> posts) {
    return posts.map((post) {
      // Extract text from the oneof content field
      String text = '';
      List<String> mediaUrls = [];
      
      switch (post.whichContent()) {
        case Post_Content.textPost:
          text = post.textPost.text;
          break;
        case Post_Content.imagePost:
          text = post.imagePost.text;
          mediaUrls = post.imagePost.images.map((img) => img.url).toList();
          break;
        case Post_Content.videoPost:
          text = post.videoPost.text;
          if (post.videoPost.hasVideo()) {
            mediaUrls.add(post.videoPost.video.url);
          }
          break;
        case Post_Content.linkPost:
          text = post.linkPost.text;
          break;
        case Post_Content.pollPost:
          text = post.pollPost.text;
          break;
        case Post_Content.repostPost:
          text = post.repostPost.comment;
          break;
        case Post_Content.locationPost:
          text = post.locationPost.text;
          mediaUrls = post.locationPost.images.map((img) => img.url).toList();
          break;
        default:
          text = '';
      }
      LoggingService.debug('Discovery: Post ${post.id} - author=${post.author.username}, authorId=${post.author.id}, avatarUrl="${post.author.avatarUrl}" (isEmpty: ${post.author.avatarUrl.isEmpty})');
      
      final item = DiscoveryItem(
        id: post.id,
        objectId: post.id,
        title: text.isNotEmpty ? text : 'Post',
        content: text,
        author: post.author.username,
        authorId: post.author.id,
        authorAvatar: post.author.avatarUrl,
        timestamp: post.createdAt.toDateTime(),
        type: 'Create',
        images: mediaUrls,
        likesCount: post.stats.likesCount.toInt(),
        commentsCount: post.stats.commentsCount.toInt(),
        sharesCount: post.stats.repostsCount.toInt(),
        isLiked: post.interaction.isLiked,
        comments: [],
      );
      
      return item;
    }).toList();
  }

  Future<void> loadComments(DiscoveryItem item, {String? cursor}) async {
    try {
      final data = await _repo.fetchObjectReplies(item.objectId, cursor: cursor, limit: 10);
      LoggingService.debug('loadComments: Received data: $data');
      
      if (data['orderedItems'] is List) {
        final commentsList = data['orderedItems'] as List;
        LoggingService.debug('loadComments: Found ${commentsList.length} comments');
        final comments = <DiscoveryComment>[];
        
        for (var obj in commentsList) {
          if (obj is Map) {
            String authorId = '';
            String authorName = 'Unknown';
            String authorAvatar = '';
            
            if (obj['attributedTo'] is Map) {
              final attr = obj['attributedTo'] as Map;
              
              authorId = attr['id']?.toString() ?? '';
              
              final nameField = attr['name'];
              if (nameField is String) {
                authorName = nameField;
              } else if (nameField is Map) {
                authorName = nameField.values.firstOrNull?.toString() ?? '';
              }
              
              if (authorName.isEmpty) {
                final prefUsernameField = attr['preferredUsername'];
                if (prefUsernameField is String) {
                  authorName = prefUsernameField;
                } else if (prefUsernameField is Map) {
                  authorName = prefUsernameField.values.firstOrNull?.toString() ?? '';
                }
              }
              
              if (authorName.isEmpty) {
                authorName = 'Unknown';
              }
              
              if (attr['icon'] is Map) {
                final iconMap = attr['icon'] as Map;
                final iconUrl = iconMap['url'];
                if (iconUrl is String) {
                  authorAvatar = iconUrl;
                } else if (iconUrl != null) {
                  authorAvatar = iconUrl.toString();
                }
              }
            } else if (obj['attributedTo'] is String) {
              authorName = (obj['attributedTo'] as String).split('/').last;
            }
            
            String content = '';
            final contentField = obj['content'];
            if (contentField is String) {
              content = contentField;
            } else if (contentField is Map) {
              content = contentField.values.firstOrNull?.toString() ?? '';
            }
            
            LoggingService.debug('loadComments: Parsed comment - authorId: $authorId, author: $authorName, content: $content');
            
            comments.add(DiscoveryComment(
              id: obj['id']?.toString() ?? '',
              authorId: authorId,
              authorName: authorName,
              authorAvatar: authorAvatar,
              content: content,
              timestamp: DateTime.tryParse(obj['published']?.toString() ?? '') ?? DateTime.now(),
            ));
          }
        }
        
        if (cursor == null) {
          item.comments.clear();
        }
        item.comments.addAll(comments);
        item.hasMoreComments = data['hasMore'] == true;
        item.nextCommentCursor = data['nextCursor']?.toString();
        items.refresh();
        update(['item_${item.id}']);
        LoggingService.info('loadComments: Successfully loaded ${comments.length} comments, hasMore: ${item.hasMoreComments}');
      } else {
        LoggingService.warning('loadComments: orderedItems is not a List');
      }
    } catch (e) {
      LoggingService.error('Failed to load comments: $e');
    }
  }

  Future<void> loadMoreComments(DiscoveryItem item) async {
    if (item.loadingMoreComments || !item.hasMoreComments) return;
    
    item.loadingMoreComments = true;
    update(['item_${item.id}']);
    
    try {
      await loadComments(item, cursor: item.nextCommentCursor);
    } finally {
      item.loadingMoreComments = false;
      update(['item_${item.id}']);
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

      // 2. Create reply using new Social API
      LoggingService.info('Submitting reply to ${parent.id}');
      final post = await _repo.createPost(
        text: content,
        replyTo: parent.id,
        visibility: 'public',
      );

      // 3. Update UI (Optimistic update)
      // Add comment to parent.comments
      final newComment = DiscoveryComment(
        id: post.id,
        authorId: post.author.id,
        authorName: post.author.username,
        authorAvatar: post.author.avatarUrl,
        content: content,
        timestamp: post.createdAt.toDateTime(),
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
      // Extract post ID from objectId URL
      // objectId format: http://localhost:18080/posts/{postId}
      final postId = item.objectId.split('/').last;
      
      // Use new Social API for deletion
      await _repo.deletePost(postId);
      items.remove(item);
      Get.snackbar('Success', 'Post deleted');
    } catch (e) {
      LoggingService.error('Delete failed: $e');
      Get.snackbar('Error', 'Failed to delete: $e');
    }
  }

  Future<void> likeItem(DiscoveryItem item) async {
    try {
      item.isLiked = !item.isLiked;
      if (item.isLiked) {
        item.likesCount++;
      } else {
        item.likesCount = (item.likesCount - 1).clamp(0, 999999);
      }
      items.refresh();
      
      // Use new Social API
      if (item.isLiked) {
        await _repo.likePost(item.id);
      } else {
        await _repo.unlikePost(item.id);
      }
      
      Get.snackbar('Success', item.isLiked ? 'Liked post' : 'Unliked post');
    } catch (e) {
      LoggingService.error('Like failed: $e');
      // Revert on error
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
      item.sharesCount++;
      items.refresh();
      
      // Use new Social API
      await _repo.repostPost(item.id);
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
    searchQuery.value = query;
    if (query.isEmpty) {
      searchResults.clear();
      return;
    }
    // Search in localStationActors instead of friends
    searchResults.value = localStationActors.where((f) => 
      f.name.toLowerCase().contains(query.toLowerCase()) ||
      f.id.toLowerCase().contains(query.toLowerCase())
    ).toList();
  }

  Future<void> followUser(FriendItem user) async {
    try {
      final targetActorId = user.actorId ?? user.id;
      
      LoggingService.info('Following user: $targetActorId (display name: ${user.name})');
      await _repo.followUser(targetActorId);
      Get.snackbar('Success', 'Followed ${user.name}');
      
      // Refresh friends list
      loadFriends();
    } catch (e) {
      LoggingService.error('Failed to follow user: $e');
      Get.snackbar('Error', 'Failed to follow user');
    }
  }

  Future<void> unfollowUser(FriendItem user) async {
    try {
      final targetActorId = user.actorId ?? user.id;
      
      LoggingService.info('Unfollowing user: $targetActorId (display name: ${user.name})');
      await _repo.unfollowUser(targetActorId);
      Get.snackbar('Success', 'Unfollowed ${user.name}');
      
      // Refresh friends list
      loadFriends();
    } catch (e) {
      LoggingService.error('Failed to unfollow user: $e');
      Get.snackbar('Error', 'Failed to unfollow user');
    }
  }

  List<FriendItem> _parseActorList(Map<String, dynamic> data) {
    final list = <FriendItem>[];
    final items = data['items'] ?? data['orderedItems'];
    
    if (items is List) {
      for (var item in items) {
        if (item is Map) {
          final id = item['id']?.toString() ?? '';
          final actorId = item['actor_id']?.toString() ?? id;
          final username = item['username']?.toString() ?? 
                          item['preferredUsername']?.toString() ?? '';
          final displayName = item['display_name']?.toString() ?? 
                             item['displayName']?.toString() ?? 
                             item['name']?.toString() ?? 
                             username;
          
          String avatarUrl = '';
          if (item['icon'] is Map) {
            avatarUrl = (item['icon'] as Map)['url']?.toString() ?? '';
          } else if (item['avatar'] != null) {
            avatarUrl = item['avatar']?.toString() ?? '';
          }
          
          final isFollowing = item['is_following'] == true;
          
          LoggingService.debug('_parseActorList: Parsed actor - id: $id, actorId: $actorId, username: $username, displayName: $displayName, isFollowing: $isFollowing');
          
          list.add(FriendItem(
            id: username.isNotEmpty ? username : id,
            name: displayName.isNotEmpty ? displayName : username,
            avatarUrl: avatarUrl,
            timeOrStatus: '',
            actorId: actorId,
            isOnline: false,
            isFollowing: isFollowing,
          ));
        } else if (item is String) {
           list.add(FriendItem(
             id: item,
             name: item.split('/').last,
             avatarUrl: '',
             timeOrStatus: '',
           ));
        }
      }
    }
    
    LoggingService.debug('_parseActorList: Total parsed: ${list.length} actors');
    return list;
  }
}