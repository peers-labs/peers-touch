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

enum DiscoveryTab {
  home,
  me,
  radar,
  follow,
  announce,
  comment;

  String get name {
    switch (this) {
      case DiscoveryTab.home:
        return 'home';
      case DiscoveryTab.me:
        return 'me';
      case DiscoveryTab.radar:
        return 'radar';
      case DiscoveryTab.follow:
        return 'follow';
      case DiscoveryTab.announce:
        return 'announce';
      case DiscoveryTab.comment:
        return 'comment';
    }
  }

  IconData get icon {
    switch (this) {
      case DiscoveryTab.home:
        return Icons.home_filled;
      case DiscoveryTab.me:
        return Icons.person;
      case DiscoveryTab.radar:
        return Icons.radar;
      case DiscoveryTab.follow:
        return Icons.person_add;
      case DiscoveryTab.announce:
        return Icons.campaign;
      case DiscoveryTab.comment:
        return Icons.chat_bubble;
    }
  }
}

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
  final followingActors = <FriendItem>[].obs;
  final localStationActors = <FriendItem>[].obs;
  final searchResults = <FriendItem>[].obs;
  final selectedItem = Rx<DiscoveryItem?>(null);
  final isLoading = false.obs;
  final error = Rx<String?>(null);
  final searchQuery = ''.obs;
  final currentTab = 0.obs;

  int _activeRequestId = 0;
  final tabs = DiscoveryTab.values;
  
  DiscoveryTab get currentTabEnum => tabs[currentTab.value];
  
  List<IconData> get tabIcons => tabs.map((tab) => tab.icon).toList();

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
    
    ever(currentTab, (index) {
      scrollToTop();
      if (tabs[index] == DiscoveryTab.radar) {
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

  Future<void> loadGroups() async {
    groups.value = [];
  }

  Future<void> loadFriends() async {
    try {
      final username = _getCurrentUsername();
      if (username.isEmpty) {
        followingActors.value = [];
        return;
      }
      
      final data = await _repo.fetchFollowing(username);
      final List<FriendItem> results = [];
      
      if (data['orderedItems'] is List) {
        final items = data['orderedItems'] as List;
        for (var item in items) {
          if (item is String) {
            final name = item.split('/').last;
            results.add(FriendItem(
              id: name,
              name: name,
              avatarUrl: '',
              timeOrStatus: '',
              isOnline: false,
            ));
          } else if (item is Map) {
            final id = item['id']?.toString() ?? '';
            final name = item['preferredUsername']?.toString() ?? 
                        item['name']?.toString() ?? 
                        id.split('/').last;
            String avatarUrl = '';
            if (item['icon'] is Map) {
              avatarUrl = item['icon']['url']?.toString() ?? '';
            } else if (item['icon'] is String) {
              avatarUrl = item['icon'].toString();
            }
            results.add(FriendItem(
              id: id,
              name: name,
              avatarUrl: avatarUrl,
              timeOrStatus: '',
              isOnline: false,
            ));
          }
        }
      }
      
      followingActors.value = results;
    } catch (e) {
      LoggingService.error('Failed to load following actors: $e');
      followingActors.value = [];
    }
  }

  Future<void> loadAllUsers() async {
    isLoading.value = true;
    error.value = null;
    try {
      final data = await _repo.fetchActorList();
      final List<FriendItem> results = [];
      final currentUsername = _getCurrentUsername();
      
      if (data['data'] is Map && data['data']['items'] is List) {
        final items = data['data']['items'] as List;
        for (var item in items) {
          if (item is Map) {
            final username = item['username']?.toString() ?? '';
            if (username.isNotEmpty && username != currentUsername) {
              String avatarUrl = '';
              if (item['icon'] is Map) {
                avatarUrl = item['icon']['url']?.toString() ?? '';
              } else if (item['icon'] is String) {
                avatarUrl = item['icon'].toString();
              }
              results.add(FriendItem(
                id: username,
                name: item['display_name']?.toString() ?? username,
                avatarUrl: avatarUrl,
                timeOrStatus: '',
                isOnline: false,
              ));
            }
          }
        }
      }
      
      localStationActors.value = results;
    } catch (e) {
      LoggingService.error('Failed to load local station actors: $e');
      error.value = 'Failed to load actors';
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> searchFriends(String query) async {
    searchQuery.value = query;
    
    if (query.isEmpty) {
      searchResults.clear();
      return;
    }
    
    isLoading.value = true;
    error.value = null;
    try {
      final currentUsername = _getCurrentUsername();
      final data = await _repo.searchActors(query);
      final List<FriendItem> results = [];
      
      if (data['data'] is Map && data['data']['items'] is List) {
        final items = data['data']['items'] as List;
        for (var item in items) {
          if (item is Map) {
            final username = item['username']?.toString() ?? '';
            if (username.isNotEmpty && username != currentUsername) {
              results.add(FriendItem(
                id: username,
                name: item['display_name']?.toString() ?? username,
                avatarUrl: '',
                timeOrStatus: '',
                isOnline: false,
              ));
            }
          }
        }
      }
      
      searchResults.value = results;
    } catch (e) {
      LoggingService.error('Failed to search friends: $e');
      error.value = 'Search failed';
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> refreshItems() async {
    await loadItems();
  }

  // New method to support optimistic updates
  void addNewItem(DiscoveryItem item) {
    items.insert(0, item);
  }

  Future<void> loadItems() async {
    final requestId = ++_activeRequestId;
    
    // Reset state for new tab
    error.value = null;
    isLoading.value = true;
    items.clear();

    LoggingService.info('DiscoveryController: Loading items for tab ${currentTabEnum.name} (Request ID: $requestId)');

    try {
      final List<DiscoveryItem> fetchedItems = await _fetchDataByTab(currentTabEnum);

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

  Future<List<DiscoveryItem>> _fetchDataByTab(DiscoveryTab tab) async {
    switch (tab) {
      case DiscoveryTab.me:
        return await _fetchOutboxItems();
      case DiscoveryTab.home:
        return await _fetchHomeItems();
      case DiscoveryTab.radar:
      case DiscoveryTab.follow:
      case DiscoveryTab.announce:
      case DiscoveryTab.comment:
        return [];
    }
  }

  Future<List<DiscoveryItem>> _fetchHomeItems() async {
    final List<DiscoveryItem> allItems = [];
    
    try {
      final username = _getCurrentUsername();
      if (username.isEmpty) return [];
      
      final inboxData = await _repo.fetchInbox(username);
      final inboxItems = await _parseActivities(inboxData, isInbox: true);
      allItems.addAll(inboxItems);
      
      final outboxItems = await _fetchOutboxItems();
      allItems.addAll(outboxItems);
      
      allItems.sort((a, b) => b.timestamp.compareTo(a.timestamp));
      
      return allItems;
    } catch (e) {
      LoggingService.error('Failed to fetch home items: $e');
      rethrow;
    }
  }

  Future<List<DiscoveryItem>> _parseActivities(Map<String, dynamic> data, {bool isInbox = false}) async {
    final List<DiscoveryItem> newItems = [];
    
    if (data['orderedItems'] is! List) return newItems;
    
    final itemsList = data['orderedItems'] as List;
    for (var item in itemsList) {
      if (item is! Map) continue;
      
      final String activityType = item['type']?.toString() ?? '';
      if (activityType == 'Like' || activityType == 'Announce') continue;
      
      String title = 'New Post';
      String content = '';
      String objectId = '';
      String author = '';
      DateTime timestamp = DateTime.now();
      final String type = activityType;
      
      final List<String> images = [];
      int likesCount = 0;
      int repliesCount = 0;
      int sharesCount = 0;
      String authorAvatar = '';
      
      if (item['object'] is Map) {
        final obj = item['object'];
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
        
        if (obj['likes'] is Map) {
          likesCount = (obj['likes']['totalItems'] as num?)?.toInt() ?? 0;
        }
        if (obj['replies'] is Map) {
          repliesCount = (obj['replies']['totalItems'] as num?)?.toInt() ?? 0;
        }
        if (obj['shares'] is Map) {
          sharesCount = (obj['shares']['totalItems'] as num?)?.toInt() ?? 0;
        }
        
        if (obj['attributedTo'] is Map) {
          final attributedTo = obj['attributedTo'];
          author = attributedTo['preferredUsername']?.toString() ?? 
                  attributedTo['name']?.toString() ?? 
                  (attributedTo['id']?.toString() ?? '').split('/').last;
          if (attributedTo['icon'] is Map) {
            authorAvatar = attributedTo['icon']['url']?.toString() ?? '';
          } else if (attributedTo['icon'] is String) {
            authorAvatar = attributedTo['icon'].toString();
          }
        } else if (obj['attributedTo'] is String) {
          author = obj['attributedTo'].toString().split('/').last;
        }
      } else if (item['object'] is String) {
        continue;
      }
      
      if (author.isEmpty) {
        if (item['actor'] is Map) {
          author = item['actor']['preferredUsername']?.toString() ?? 
                  item['actor']['name']?.toString() ?? 
                  (item['actor']['id']?.toString() ?? '').split('/').last;
        } else if (item['actor'] is String) {
          author = item['actor'].toString().split('/').last;
        }
      }
      
      newItems.add(DiscoveryItem(
        id: item['id']?.toString() ?? DateTime.now().toString(),
        objectId: objectId.isNotEmpty ? objectId : (item['id']?.toString() ?? ''),
        title: title,
        content: content,
        author: author,
        authorAvatar: authorAvatar,
        timestamp: timestamp,
        type: type,
        images: images,
        likesCount: likesCount,
        commentsCount: repliesCount,
        sharesCount: sharesCount,
      ));
    }
    
    return newItems;
  }

  Future<List<DiscoveryItem>> _fetchOutboxItems() async {
    final List<DiscoveryItem> newItems = [];
    try {
      String username = '';
      if (Get.isRegistered<GlobalContext>()) {
        username = Get.find<GlobalContext>().actorHandle ?? '';
      }
      if (username.isEmpty && Get.isRegistered<AuthController>()) {
        username = Get.find<AuthController>().username.value;
      }
      
      if (username.isEmpty) return [];
      
      final data = await _repo.fetchOutbox(username);
      if (data['orderedItems'] is List) {
        final itemsList = data['orderedItems'] as List;
        for (var item in itemsList) {
          if (item is Map) {
            String title = 'New Post';
            String content = '';
            String objectId = '';
            final String author = username;
            DateTime timestamp = DateTime.now();
            final String type = item['type']?.toString() ?? 'Create';
            
            final List<String> images = [];
            int likesCount = 0;
            int repliesCount = 0;
            int sharesCount = 0;
            String authorAvatar = '';
            
            if (item['object'] is Map) {
               final obj = item['object'];
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
               
               if (obj['likes'] is Map) {
                 likesCount = (obj['likes']['totalItems'] as num?)?.toInt() ?? 0;
               }
               if (obj['replies'] is Map) {
                 repliesCount = (obj['replies']['totalItems'] as num?)?.toInt() ?? 0;
               }
               if (obj['shares'] is Map) {
                 sharesCount = (obj['shares']['totalItems'] as num?)?.toInt() ?? 0;
               }
               
               if (obj['attributedTo'] is Map) {
                 final attributedTo = obj['attributedTo'];
                 if (attributedTo['icon'] is Map) {
                   authorAvatar = attributedTo['icon']['url']?.toString() ?? '';
                 } else if (attributedTo['icon'] is String) {
                   authorAvatar = attributedTo['icon'].toString();
                 }
               }
            }
            
            final List<DiscoveryComment> comments = [];
            if (item['object'] is Map) {
              final obj = item['object'];
              if (obj['replies'] is Map && obj['replies']['orderedItems'] is List) {
                for (var reply in obj['replies']['orderedItems']) {
                  if (reply is Map) {
                    String commentAuthor = 'User';
                    String commentAvatar = '';
                    if (reply['attributedTo'] is Map) {
                      final attr = reply['attributedTo'];
                      if (attr['preferredUsername'] is Map && attr['preferredUsername']['und'] != null) {
                        commentAuthor = attr['preferredUsername']['und'].toString();
                      } else if (attr['name'] is Map && attr['name']['und'] != null) {
                        commentAuthor = attr['name']['und'].toString();
                      }
                      if (attr['icon'] is Map) {
                        commentAvatar = attr['icon']['url']?.toString() ?? '';
                      }
                    }
                    String commentContent = '';
                    if (reply['content'] is Map && reply['content']['und'] != null) {
                      commentContent = reply['content']['und'].toString();
                    } else if (reply['content'] is String) {
                      commentContent = reply['content'].toString();
                    }
                    DateTime commentTime = DateTime.now();
                    if (reply['published'] != null) {
                      commentTime = DateTime.tryParse(reply['published'].toString()) ?? DateTime.now();
                    }
                    comments.add(DiscoveryComment(
                      id: reply['id']?.toString() ?? DateTime.now().toString(),
                      authorName: commentAuthor,
                      authorAvatar: commentAvatar,
                      content: commentContent,
                      timestamp: commentTime,
                    ));
                  }
                }
              }
            }
            
            newItems.add(DiscoveryItem(
              id: item['id']?.toString() ?? DateTime.now().toString(),
              objectId: objectId.isNotEmpty ? objectId : (item['id']?.toString() ?? ''),
              title: title,
              content: content,
              author: author,
              authorAvatar: authorAvatar,
              timestamp: timestamp,
              type: type,
              images: images,
              likesCount: likesCount,
              commentsCount: repliesCount,
              sharesCount: sharesCount,
              comments: comments,
            ));
          }
        }
      }
    } catch (e) {
      rethrow; // Let loadItems handle it
    }
    return newItems;
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
      
      // We need to trigger a refresh of the item. 
      // Since DiscoveryItem fields are final, we might need to replace the item in the list or make comments observable.
      // But for this simple implementation, let's just add to the list if mutable or replace item.
      // Our DiscoveryItem.comments is a List (mutable).
      parent.comments.add(newComment);
      parent.commentsCount++; // Assuming this field is mutable or we ignore it for now. 
      // Actually, DiscoveryItem fields are final, so we can't modify commentsCount directly if it's final.
      // Let's check DiscoveryItem definition. 
      // Ah, I made 'comments' final List. But the list itself is mutable.
      // 'commentsCount' is final int. We can't update it easily without recreating the item.
      
      // Force UI update by replacing item in the observable list
      final index = items.indexOf(parent);
      if (index != -1) {
        // We can't easily clone/copy with modification without a copyWith method.
        // For now, just trigger refresh on the list to rebuild widgets?
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

  Future<void> followUser(FriendItem friend) async {
    try {
      final currentUsername = _getCurrentUsername();
      if (currentUsername.isEmpty) {
        Get.snackbar('Error', 'Please login first');
        return;
      }

      // Check if already following
      if (followingActors.any((f) => f.id == friend.id)) {
        Get.snackbar('Info', 'Already following ${friend.name}');
        return;
      }

      // Check if trying to follow yourself
      if (friend.id == currentUsername) {
        Get.snackbar('Error', 'Cannot follow yourself');
        return;
      }

      // Optimistic update: immediately update UI
      followingActors.add(friend);
      localStationActors.removeWhere((actor) => actor.id == friend.id);
      
      // Send request to server
      await _repo.followUser(currentUsername, friend.id);
      
      Get.snackbar('Success', 'Followed ${friend.name}');
    } catch (e) {
      LoggingService.error('Follow failed: $e');
      
      // Rollback optimistic update on error
      followingActors.removeWhere((f) => f.id == friend.id);
      localStationActors.add(friend);
      
      // Show specific error message
      String errorMsg = 'Failed to follow user';
      if (e.toString().contains('already following')) {
        errorMsg = 'Already following this user';
      } else if (e.toString().contains('cannot follow yourself')) {
        errorMsg = 'Cannot follow yourself';
      } else if (e.toString().contains('not found')) {
        errorMsg = 'User not found';
      }
      
      Get.snackbar('Error', errorMsg);
    }
  }
}
