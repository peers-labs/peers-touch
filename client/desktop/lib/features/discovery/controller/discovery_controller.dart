import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/discovery/model/discovery_item.dart';

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
  final tabs = ['Home', 'Create', 'Like', 'Follow', 'Announce', 'Comment'];
  final tabIcons = <IconData>[
    Icons.home_filled,
    Icons.create,
    Icons.favorite,
    Icons.person_add,
    Icons.campaign,
    Icons.chat_bubble,
  ];

  @override
  void onInit() {
    super.onInit();
    loadItems();
    loadGroups();
    loadFriends();
    
    // React to tab changes
    ever(currentTab, (_) => loadItems());
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

  void loadItems() async {
    isLoading.value = true;
    await Future.delayed(const Duration(milliseconds: 300)); 
    
    final List<DiscoveryItem> newItems = [];
    final tabName = tabs[currentTab.value];
    
    // Helper to add items
    void add(String title, String content, String author, String type) {
      newItems.add(DiscoveryItem(
        id: '${DateTime.now().microsecondsSinceEpoch}_${newItems.length}',
        title: title,
        content: content,
        author: author,
        timestamp: DateTime.now().subtract(Duration(minutes: newItems.length * 15)),
        type: type,
      ));
    }

    if (tabName == 'Home' || tabName == 'Create') {
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
  }

  void selectItem(DiscoveryItem item) {
    selectedItem.value = item;
  }
  
  void setSearchQuery(String query) {
    searchQuery.value = query;
  }
}
