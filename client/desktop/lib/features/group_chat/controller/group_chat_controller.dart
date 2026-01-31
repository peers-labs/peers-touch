import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/network/group_chat/group_chat_api_service.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';

/// Controller for group chat functionality
class GroupChatController extends GetxController {
  final groups = <GroupInfo>[].obs;
  final currentGroup = Rx<GroupInfo?>(null);
  final messages = <GroupMessageInfo>[].obs;
  final isLoading = false.obs;
  final isSending = false.obs;
  final error = Rx<String?>(null);

  late final TextEditingController inputController = TextEditingController();
  final _api = GroupChatApiService();

  String get currentUserId {
    final gc = Get.find<GlobalContext>();
    return gc.actorId ?? '';
  }

  String get currentUserName {
    final gc = Get.find<GlobalContext>();
    final session = gc.currentSession;
    return session?['username'] as String? ?? 'Me';
  }

  @override
  void onInit() {
    super.onInit();
    refreshGroups();
  }

  @override
  void onClose() {
    inputController.dispose();
    super.onClose();
  }

  /// Refresh the list of groups the current user belongs to
  Future<void> refreshGroups() async {
    isLoading.value = true;
    error.value = null;

    try {
      final loadedGroups = await _api.listGroups(limit: 50, offset: 0);
      groups.value = loadedGroups;
      LoggingService.info('Loaded ${groups.length} groups');
    } catch (e) {
      LoggingService.error('Failed to load groups: $e');
      error.value = 'Failed to load groups';
    } finally {
      isLoading.value = false;
    }
  }

  /// Select a group to view its messages
  Future<void> selectGroup(GroupInfo group) async {
    currentGroup.value = group;
    messages.clear();
    await loadMessages(group.ulid);
  }

  /// Load messages for a group
  Future<void> loadMessages(String groupUlid, {String? beforeUlid}) async {
    try {
      final loadedMessages = await _api.getMessages(
        groupUlid,
        beforeUlid: beforeUlid,
        limit: 50,
      );
      
      if (beforeUlid != null) {
        messages.insertAll(0, loadedMessages);
      } else {
        messages.value = loadedMessages;
      }
      LoggingService.info('Loaded ${loadedMessages.length} messages for group $groupUlid');
    } catch (e) {
      LoggingService.error('Failed to load messages: $e');
      error.value = 'Failed to load messages';
    }
  }

  /// Send a message to the current group
  Future<void> sendMessage(String content) async {
    final group = currentGroup.value;
    if (group == null || content.isEmpty) return;

    isSending.value = true;
    error.value = null;

    try {
      final newMessage = await _api.sendMessage(
        groupUlid: group.ulid,
        content: content,
        type: 1, // TEXT
      );
      messages.add(newMessage);
      inputController.clear();
      LoggingService.info('Message sent to group ${group.ulid}');
    } catch (e) {
      LoggingService.error('Failed to send message: $e');
      error.value = 'Failed to send message';
    } finally {
      isSending.value = false;
    }
  }

  /// Create a new group
  Future<GroupInfo?> createGroup({
    required String name,
    String description = '',
    int type = 1,
    int visibility = 1,
    List<String> initialMemberDids = const [],
  }) async {
    try {
      final newGroup = await _api.createGroup(
        name: name,
        description: description,
        type: type,
        visibility: visibility,
        initialMemberDids: initialMemberDids,
      );
      groups.insert(0, newGroup);
      LoggingService.info('Created group: ${newGroup.name}');
      return newGroup;
    } catch (e) {
      LoggingService.error('Failed to create group: $e');
      error.value = 'Failed to create group';
      return null;
    }
  }

  /// Leave a group
  Future<bool> leaveGroup(String groupUlid) async {
    try {
      final success = await _api.leaveGroup(groupUlid);
      if (success) {
        groups.removeWhere((g) => g.ulid == groupUlid);
        if (currentGroup.value?.ulid == groupUlid) {
          currentGroup.value = null;
          messages.clear();
        }
        LoggingService.info('Left group: $groupUlid');
      }
      return success;
    } catch (e) {
      LoggingService.error('Failed to leave group: $e');
      error.value = 'Failed to leave group';
      return false;
    }
  }
}
