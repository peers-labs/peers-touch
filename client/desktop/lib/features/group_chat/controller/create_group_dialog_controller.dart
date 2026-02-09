import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/network/social/social_api_service.dart';
import 'package:peers_touch_desktop/features/group_chat/controller/group_chat_controller.dart';

/// Friend info model for create group dialog
class FriendInfo {
  final String did;
  final String name;
  final String username;
  final String? avatarUrl;

  FriendInfo({
    required this.did,
    required this.name,
    required this.username,
    this.avatarUrl,
  });
}

/// Controller for CreateGroupDialog
/// Per ADR-002: All state managed via GetX Controller
class CreateGroupDialogController extends GetxController {
  final nameController = TextEditingController();
  
  // State
  final type = 1.obs; // 1=普通群, 2=公告群, 3=讨论群
  final visibility = 1.obs; // 1=公开, 2=私密
  final isCreating = false.obs;
  final isLoadingFriends = true.obs;
  final selectedMembers = <String>{}.obs;
  final friends = <FriendInfo>[].obs;
  
  @override
  void onInit() {
    super.onInit();
    loadFriends();
  }
  
  @override
  void onClose() {
    nameController.dispose();
    super.onClose();
  }
  
  Future<void> loadFriends() async {
    try {
      final socialApi = SocialApiService();
      final response = await socialApi.getFollowing();
      friends.value = response.following
          .map((f) => FriendInfo(
                did: f.actorId,
                name: f.displayName.isNotEmpty ? f.displayName : f.username,
                username: f.username,
                avatarUrl: f.avatarUrl,
              ))
          .toList();
      isLoadingFriends.value = false;
    } catch (e) {
      isLoadingFriends.value = false;
    }
  }
  
  void setType(int value) => type.value = value;
  
  void setVisibility(int value) => visibility.value = value;
  
  void toggleMember(String did) {
    if (selectedMembers.contains(did)) {
      selectedMembers.remove(did);
    } else {
      selectedMembers.add(did);
    }
  }
  
  bool get canCreate =>
      !isCreating.value && 
      nameController.text.trim().isNotEmpty && 
      selectedMembers.length >= 2;
  
  Future<bool> createGroup() async {
    if (!canCreate) return false;
    
    isCreating.value = true;
    
    try {
      final controller = Get.find<GroupChatController>();
      final group = await controller.createGroup(
        name: nameController.text.trim(),
        type: type.value,
        visibility: visibility.value,
        initialMemberDids: selectedMembers.toList(),
      );
      
      if (group != null) {
        controller.selectGroup(group);
        return true;
      }
      return false;
    } finally {
      isCreating.value = false;
    }
  }
}
