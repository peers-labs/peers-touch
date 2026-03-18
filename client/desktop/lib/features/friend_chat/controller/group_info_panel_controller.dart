import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/network/group_chat/group_chat_api_service.dart';
import 'package:peers_touch_base/storage/chat/chat_cache_service.dart';
import 'package:peers_touch_desktop/features/friend_chat/controller/friend_chat_controller.dart';

/// Controller for GroupInfoPanel
/// Per ADR-002: All state managed via GetX Controller
class GroupInfoPanelController extends GetxController {
  GroupInfoPanelController({
    required this.groupUlid,
    required this.onClosePanel,
  });
  
  final String groupUlid;
  final VoidCallback onClosePanel;
  
  final _api = GroupChatApiService();
  final searchController = TextEditingController();
  
  // State
  final group = Rx<GroupInfo?>(null);
  final members = <GroupMemberInfo>[].obs;
  final mySettings = <String, dynamic>{}.obs;
  final isLoading = true.obs;
  final error = Rx<String?>(null);
  
  @override
  void onInit() {
    super.onInit();
    loadData();
  }
  
  @override
  void onClose() {
    searchController.dispose();
    super.onClose();
  }
  
  Future<void> loadData() async {
    isLoading.value = true;
    error.value = null;
    
    try {
      // Load group info and members (required)
      final groupFuture = _api.getGroupInfo(groupUlid);
      final membersFuture = _api.getMembers(groupUlid);
      
      final results = await Future.wait([groupFuture, membersFuture]);
      
      group.value = results[0] as GroupInfo;
      members.value = results[1] as List<GroupMemberInfo>;
      
      // Load settings separately (optional, may fail)
      try {
        mySettings.value = await _api.getMySettings(groupUlid);
      } catch (_) {
        // Settings API may not be fully implemented, use defaults
        mySettings.value = {
          'is_muted': false,
          'is_pinned': false,
          'my_nickname': '',
        };
      }
      
      isLoading.value = false;
    } catch (e) {
      error.value = e.toString();
      isLoading.value = false;
    }
  }
  
  String get myNickname => mySettings['my_nickname'] as String? ?? '';
  bool get isMuted => mySettings['is_muted'] as bool? ?? false;
  bool get isPinned => mySettings['is_pinned'] as bool? ?? false;
  
  Future<void> updateGroupName(String newName) async {
    if (newName.isEmpty || newName == group.value?.name) return;
    
    try {
      await _api.updateGroup(groupUlid: groupUlid, name: newName);
      loadData();
      Get.snackbar('Success', 'Group name updated');
    } catch (e) {
      Get.snackbar('Error', 'Failed to update group name: $e');
    }
  }
  
  Future<void> updateAnnouncement(String newAnnouncement) async {
    if (newAnnouncement == group.value?.description) return;
    
    try {
      await _api.updateGroup(groupUlid: groupUlid, description: newAnnouncement);
      loadData();
      Get.snackbar('Success', 'Announcement updated');
    } catch (e) {
      Get.snackbar('Error', 'Failed to update announcement: $e');
    }
  }
  
  Future<void> updateMyNickname(String newNickname) async {
    if (newNickname == myNickname) return;
    
    try {
      await _api.updateMyNickname(groupUlid: groupUlid, nickname: newNickname);
      loadData();
      Get.snackbar('Success', 'Nickname updated');
    } catch (e) {
      Get.snackbar('Error', 'Failed to update nickname: $e');
    }
  }
  
  Future<void> updateMuteStatus(bool muted) async {
    try {
      await _api.updateMySettings(groupUlid: groupUlid, isMuted: muted);
      mySettings['is_muted'] = muted;
      mySettings.refresh();
    } catch (e) {
      Get.snackbar('Error', 'Failed to update mute status: $e');
    }
  }
  
  Future<void> updatePinnedStatus(bool pinned) async {
    try {
      await _api.updateMySettings(groupUlid: groupUlid, isPinned: pinned);
      mySettings['is_pinned'] = pinned;
      mySettings.refresh();
      // Notify controller to refresh session list
      Get.find<FriendChatController>().refreshSessions();
    } catch (e) {
      Get.snackbar('Error', 'Failed to update pinned status: $e');
    }
  }
  
  Future<void> clearHistory() async {
    // Clear local messages in controller
    final controller = Get.find<FriendChatController>();
    controller.groupMessages.clear();
    
    // Clear unread count from cache
    try {
      final cache = ChatCacheService.instance;
      await cache.clearUnreadCount(groupUlid);
    } catch (e) {
      // Cache might not be initialized
    }
    
    Get.snackbar('Success', 'Chat history cleared');
  }
  
  Future<bool> leaveGroup() async {
    // Check if user is owner
    final isOwner = group.value?.ownerDid == Get.find<FriendChatController>().currentUserId;
    
    if (isOwner) {
      Get.snackbar('Cannot Leave', 'Group owner cannot leave. Transfer ownership first or delete the group.');
      return false;
    }
    
    try {
      await _api.leaveGroup(groupUlid);
      Get.snackbar('Success', 'Left group');
      onClosePanel();
      Get.find<FriendChatController>().refreshSessions();
      return true;
    } catch (e) {
      Get.snackbar('Error', 'Failed to leave group: $e');
      return false;
    }
  }
  
  Future<void> inviteMember(String actorDid) async {
    if (actorDid.isEmpty) return;
    
    try {
      await _api.inviteToGroup(groupUlid, [actorDid]);
      Get.snackbar('Success', 'Invitation sent');
      loadData();
    } catch (e) {
      Get.snackbar('Error', 'Failed to invite: $e');
    }
  }
  
  Future<List<GroupMessageInfo>> searchMessages(String query) async {
    if (query.isEmpty) return [];
    
    try {
      return await _api.searchMessages(groupUlid: groupUlid, query: query);
    } catch (e) {
      Get.snackbar('Error', 'Search failed: $e');
      return [];
    }
  }
  
  String truncateActorId(String actorId) {
    if (actorId.length <= 8) return actorId;
    return '${actorId.substring(0, 8)}...';
  }
  
  String formatDate(int timestamp) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp * 1000);
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  }
}

/// Controller for ChatSearchDialog
class ChatSearchDialogController extends GetxController {
  ChatSearchDialogController({
    required this.groupUlid,
    this.initialQuery,
  });
  
  final String groupUlid;
  final String? initialQuery;
  
  final _api = GroupChatApiService();
  final searchController = TextEditingController();
  final results = <GroupMessageInfo>[].obs;
  final isLoading = false.obs;
  
  @override
  void onInit() {
    super.onInit();
    if (initialQuery != null) {
      searchController.text = initialQuery!;
      search();
    }
  }
  
  @override
  void onClose() {
    searchController.dispose();
    super.onClose();
  }
  
  Future<void> search() async {
    final query = searchController.text.trim();
    if (query.isEmpty) return;
    
    isLoading.value = true;
    
    try {
      final searchResults = await _api.searchMessages(groupUlid: groupUlid, query: query);
      results.value = searchResults;
    } catch (e) {
      Get.snackbar('Error', 'Search failed: $e');
    } finally {
      isLoading.value = false;
    }
  }
}
