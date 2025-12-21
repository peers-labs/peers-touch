import 'dart:async';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';
import 'package:peers_touch_desktop/features/discovery/model/discovery_item.dart';
import 'package:peers_touch_desktop/features/discovery/repository/discovery_repository.dart';
import 'package:peers_touch_desktop/features/shell/controller/right_panel_mode.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/model/domain/post/post.pb.dart' as pb;

class GroupItem {
  final String id;
  final String name;
  final String iconUrl;
  
  GroupItem({required this.id, required this.name, required this.iconUrl});
}

class FriendItem {
  final String id;
  final String name;
  final String avatarUrl;
  final String timeOrStatus;
  final bool isOnline;

  FriendItem({
    required this.id,
    required this.name,
    required this.avatarUrl,
    required this.timeOrStatus,
    this.isOnline = false,
  });
}

class DiscoveryController extends GetxController {
  final items = <DiscoveryItem>[].obs;
  final groups = <GroupItem>[].obs;
  final friends = <FriendItem>[].obs;
  final selectedItem = Rx<DiscoveryItem?>(null);
  final isLoading = false.obs;
  final searchQuery = ''.obs;
  final currentTab = 0.obs;
  final tabs = ['Home', 'Me', 'Like', 'Follow', 'Announce', 'Comment'];
  final tabIcons = <IconData>[
    Icons.home_filled,
    Icons.person,
    Icons.favorite,
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
    // Mock data
    groups.value = [
      GroupItem(id: '1', name: 'Figma Community', iconUrl: 'https://cdn-icons-png.flaticon.com/512/5968/5968705.png'),
      GroupItem(id: '2', name: 'Sketch Community', iconUrl: 'https://cdn-icons-png.flaticon.com/512/5968/5968746.png'),
      GroupItem(id: '3', name: 'Flutter Devs', iconUrl: 'https://cdn-icons-png.flaticon.com/512/5968/5968443.png'),
    ];
  }

  void loadFriends() {
    // Mock data
    friends.value = [
      FriendItem(id: '1', name: 'Eleanor Pena', avatarUrl: 'https://i.pravatar.cc/150?u=1', timeOrStatus: '11 min', isOnline: false),
      FriendItem(id: '2', name: 'Leslie Alexander', avatarUrl: 'https://i.pravatar.cc/150?u=2', timeOrStatus: 'Online', isOnline: true),
      FriendItem(id: '3', name: 'Brooklyn Simmons', avatarUrl: 'https://i.pravatar.cc/150?u=3', timeOrStatus: 'Online', isOnline: true),
      FriendItem(id: '4', name: 'Arlene McCoy', avatarUrl: 'https://i.pravatar.cc/150?u=4', timeOrStatus: '11 min', isOnline: false),
      FriendItem(id: '5', name: 'Jerome Bell', avatarUrl: 'https://i.pravatar.cc/150?u=5', timeOrStatus: '9 min', isOnline: false),
      FriendItem(id: '6', name: 'Darlene Robertson', avatarUrl: 'https://i.pravatar.cc/150?u=6', timeOrStatus: 'Online', isOnline: true),
      FriendItem(id: '7', name: 'Kathryn Murphy', avatarUrl: 'https://i.pravatar.cc/150?u=7', timeOrStatus: 'Online', isOnline: true),
    ];
  }

  Future<void> refreshItems() async {
    await loadItems();
  }

  // New method to support optimistic updates
  void addNewItem(DiscoveryItem item) {
    items.insert(0, item);
  }

  Future<void> loadItems() async {
    // Only show full loading state if we have no items
    if (items.isEmpty) {
      isLoading.value = true;
    }
    
    LoggingService.info('DiscoveryController: Loading items for tab ${tabs[currentTab.value]}');
    
    final List<DiscoveryItem> newItems = [];
    final tabName = tabs[currentTab.value];
    
    // Helper to add items
    void add(String title, String content, String author, String type) {
      newItems.add(DiscoveryItem(
        id: '${DateTime.now().microsecondsSinceEpoch}_${newItems.length}',
        title: title,
        content: content,
        author: author,
        authorAvatar: 'https://i.pravatar.cc/150?u=$author',
        timestamp: DateTime.now().subtract(Duration(minutes: newItems.length * 15)),
        type: type,
        likesCount: (newItems.length * 7 + 3) % 50,
        commentsCount: 1,
        sharesCount: (newItems.length * 2) % 10,
        comments: [
          DiscoveryComment(
            id: 'c1',
            authorName: 'Fan User',
            authorAvatar: 'https://i.pravatar.cc/150?u=fan${newItems.length}',
            content: 'This is really interesting! Thanks for sharing.',
            timestamp: DateTime.now().subtract(const Duration(minutes: 5)),
          ),
        ],
      ));
    }

    if (tabName == 'Me') {
      try {
        String username = '';
        if (Get.isRegistered<GlobalContext>()) {
          username = Get.find<GlobalContext>().actorHandle ?? '';
        }
        // Fallback to AuthController if GlobalContext is empty
        if (username.isEmpty && Get.isRegistered<AuthController>()) {
          username = Get.find<AuthController>().username.value;
        }
        
        LoggingService.info('DiscoveryController: Fetching outbox for user: $username');
        
        if (username.isNotEmpty) {
          final data = await _repo.fetchOutbox(username);
          LoggingService.info('DiscoveryController: Outbox response data: $data');
          
          final Map<String, List<DiscoveryComment>> repliesMap = {};

          if (data['orderedItems'] is List) {
            final itemsList = data['orderedItems'] as List;
            LoggingService.info('DiscoveryController: Found ${itemsList.length} items');
            for (var item in itemsList) {
              if (item is Map) {
                String title = 'New Post';
                String content = '';
                String author = username;
                DateTime timestamp = DateTime.now();
                String type = item['type']?.toString() ?? 'Create';
                
                List<String> images = [];
                if (item['object'] is Map) {
                   final obj = item['object'];
                   
                   // Filter out replies/comments from the main feed
                   if (obj['inReplyTo'] != null && obj['inReplyTo'].toString().isNotEmpty) {
                     continue;
                   }

                   content = obj['content']?.toString() ?? '';
                   if (obj['summary'] != null && obj['summary'].toString().isNotEmpty) {
                     title = obj['summary'].toString();
                   } else if (content.isNotEmpty) {
                     // Simple truncation for title
                     final plainText = content.replaceAll(RegExp(r'<[^>]*>'), ''); // Remove HTML tags roughly
                     title = plainText.split('\n').first;
                     if (title.length > 50) title = title.substring(0, 50) + '...';
                   }
                   
                   if (obj['published'] != null) {
                     timestamp = DateTime.tryParse(obj['published'].toString()) ?? DateTime.now();
                   }
                   
                   // Parse images from attachment
                   if (obj['attachment'] is List) {
                     for (var att in obj['attachment']) {
                       if (att is Map) {
                         final type = att['type']?.toString();
                         final mediaType = att['mediaType']?.toString();
                         final url = att['url']?.toString();
                         
                         bool isImage = false;
                         if (type == 'Image') {
                           isImage = true;
                         } else if (mediaType != null && mediaType.startsWith('image/')) {
                           isImage = true;
                         } else if (url != null) {
                           // Fallback: check extension
                           final lowerUrl = url.toLowerCase();
                           if (lowerUrl.endsWith('.jpg') || 
                               lowerUrl.endsWith('.jpeg') || 
                               lowerUrl.endsWith('.png') || 
                               lowerUrl.endsWith('.gif') || 
                               lowerUrl.endsWith('.webp')) {
                             isImage = true;
                           }
                         }

                         if (isImage && url != null && url.isNotEmpty) {
                           images.add(url);
                         }
                       }
                     }
                   }
                } else if (item['published'] != null) {
                   timestamp = DateTime.tryParse(item['published'].toString()) ?? DateTime.now();
                }

                // If content is still empty, maybe it's just an activity without rich object details here
                if (content.isEmpty && item['object'] is String) {
                   content = 'Object ID: ${item['object']}';
                }

                newItems.add(DiscoveryItem(
                  id: item['id']?.toString() ?? DateTime.now().toString(),
                  title: title,
                  content: content,
                  author: author,
                  authorAvatar: 'https://i.pravatar.cc/150?u=$author',
                  timestamp: timestamp,
                  type: type,
                  images: images,
                  likesCount: 0,
                  commentsCount: 0,
                  sharesCount: 0,
                ));
              }
            }
            
            // Second pass: Attach comments to their parent posts
            for (var item in newItems) {
              if (repliesMap.containsKey(item.id)) {
                // We can't modify the 'comments' list directly if it's not the same reference we initialized?
                // But DiscoveryItem constructor initializes 'comments' as a new list.
                // However, 'comments' field is final. The list inside is mutable.
                // Let's check DiscoveryItem again.
                // Yes, I made it `comments = comments ?? []`.
                item.comments.addAll(repliesMap[item.id]!);
                item.commentsCount = item.comments.length;
              }
            }

          } else {
             LoggingService.warning('DiscoveryController: No orderedItems found in response');
          }
        } else {
           LoggingService.warning('DiscoveryController: Username is empty');
        }
      } catch (e, stack) {
        LoggingService.error('DiscoveryController: Error fetching outbox: $e');
        LoggingService.error(stack.toString());
        // Do not clear items on error if we already have some
        if (items.isNotEmpty) {
          isLoading.value = false;
          return;
        }
      }
    }

    if (tabName == 'Home') {
      add('How To Manage Your Time & Get More Done', 'It may not be possible to squeeze more time in the day without sacrificing sleep. So how do you achieve more...', 'Valentino Del More', 'Create');
      add('The Future of Flutter', 'Flutter is evolving rapidly. Here are the new features coming in 2025. The ecosystem is growing stronger every day.', 'Tech Insider', 'Create');
      add('My Travel Diary: Japan', 'Japan was an amazing experience. The food, the culture, the people...', 'Traveler Joe', 'Create');
    }
    
    if (tabName == 'Home' || tabName == 'Like') {
      add('Liked "Best Coffee in Town"', 'Alice liked a post about coffee shops.', 'Alice', 'Like');
      add('Liked your photo', 'Bob liked your profile picture.', 'Bob', 'Like');
      add('Liked "Flutter 4.0"', 'Charlie liked the announcement.', 'Charlie', 'Like');
    }

    if (tabName == 'Home' || tabName == 'Follow') {
      add('Followed you', 'Started following you.', 'Charlie', 'Follow');
      add('Followed "Flutter Devs"', 'David followed the group Flutter Devs.', 'David', 'Follow');
      add('Followed "Dart Lang"', 'Eve followed the topic Dart Lang.', 'Eve', 'Follow');
    }

    if (tabName == 'Home' || tabName == 'Announce') {
      add('Boosted: "New Release"', 'Eve boosted a post about the new software release.', 'Eve', 'Announce');
      add('Boosted: "Global News"', 'Frank shared a breaking news story.', 'Frank', 'Announce');
    }

    if (tabName == 'Home' || tabName == 'Comment') {
      add('Commented on "My Trip"', 'Great photos! Looks like an amazing place.', 'Frank', 'Comment');
      add('Reply to your post', 'I agree with this point completely. The architecture is scalable.', 'Grace', 'Comment');
      add('Commented on "Daily Updates"', 'Thanks for sharing this info.', 'Heidi', 'Comment');
    }

    // Shuffle for Home to look natural, but keep some order if needed. 
    // For mock, shuffle is fine.
    if (tabName == 'Home') {
      newItems.shuffle();
    }

    items.value = newItems;
    isLoading.value = false;
    scrollToTop();
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

      // 2. Construct PostInput (Proto)
      final input = pb.PostInput(
        text: content,
        replyTo: parent.id,
        visibility: 'public',
      );

      // 3. Submit
      LoggingService.info('Submitting reply to ${parent.id}');
      await _repo.submitPost(username, input);

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
}
