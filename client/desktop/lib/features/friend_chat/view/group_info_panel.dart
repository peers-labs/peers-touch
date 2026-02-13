import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/network/group_chat/group_chat_api_service.dart';
import 'package:peers_touch_base/widgets/avatar.dart';
import 'package:peers_touch_desktop/features/friend_chat/controller/group_info_panel_controller.dart';

/// 微信风格的群信息侧边面板
/// StatelessWidget per project convention (ADR-002)
class GroupInfoPanel extends StatelessWidget {
  const GroupInfoPanel({
    super.key,
    required this.groupUlid,
    required this.onClose,
  });

  final String groupUlid;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    // Create controller for this panel
    final controller = Get.put(
      GroupInfoPanelController(groupUlid: groupUlid, onClosePanel: onClose),
      tag: groupUlid, // Use tag to support multiple panels
    );
    final theme = Theme.of(context);
    
    return Container(
      width: 300,
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          left: BorderSide(color: theme.dividerColor, width: 1),
        ),
      ),
      child: Column(
        children: [
          // Search bar
          _buildSearchBar(context, controller),
          const Divider(height: 1),
          
          // Content
          Expanded(
            child: Obx(() {
              if (controller.isLoading.value) {
                return const Center(child: CircularProgressIndicator());
              }
              if (controller.error.value != null) {
                return Center(
                  child: Text(
                    controller.error.value!,
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                );
              }
              return _buildContent(context, controller);
            }),
          ),
        ],
      ),
    );
  }
  
  Widget _buildSearchBar(BuildContext context, GroupInfoPanelController controller) {
    return Padding(
      padding: const EdgeInsets.all(8),
      child: TextField(
        controller: controller.searchController,
        decoration: InputDecoration(
          hintText: 'Search',
          prefixIcon: const Icon(Icons.search, size: 20),
          isDense: true,
          filled: true,
          fillColor: Theme.of(context).colorScheme.surfaceContainerHighest,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide.none,
          ),
          contentPadding: const EdgeInsets.symmetric(vertical: 8),
        ),
        onSubmitted: (query) => _showChatSearch(context, controller, query),
      ),
    );
  }
  
  Widget _buildContent(BuildContext context, GroupInfoPanelController controller) {
    final theme = Theme.of(context);
    
    return Obx(() {
      final myNickname = controller.myNickname;
      final isMuted = controller.isMuted;
      final isPinned = controller.isPinned;
      
      return ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          // Members section
          _buildMembersSection(context, controller),
          const SizedBox(height: 12),
          
          // Group Name
          _buildListTile(
            context,
            title: 'Group Name',
            subtitle: controller.group.value?.name ?? '',
            onTap: () => _showEditNameDialog(context, controller),
          ),
          
          // Group Notice
          _buildListTile(
            context,
            title: 'Group Notice',
            subtitle: controller.group.value?.description.isNotEmpty == true 
                ? controller.group.value!.description 
                : 'Not set by group owner',
            onTap: () => _showAnnouncementDialog(context, controller),
          ),
          
          // My Alias in Group
          _buildListTile(
            context,
            title: 'My Alias in Group',
            subtitle: myNickname.isNotEmpty ? myNickname : 'Not set',
            onTap: () => _showEditNicknameDialog(context, controller),
          ),
          
          const Divider(height: 24),
          
          // Search Chat History
          _buildListTile(
            context,
            title: 'Search Chat History',
            trailing: const Icon(Icons.chevron_right, size: 20),
            onTap: () => _showChatSearch(context, controller, null),
          ),
          
          const Divider(height: 24),
          
          // Mute Notifications
          _buildSwitchTile(
            context,
            title: 'Mute Notifications',
            value: isMuted,
            onChanged: (value) => controller.updateMuteStatus(value),
          ),
          
          // Sticky
          _buildSwitchTile(
            context,
            title: 'Sticky',
            value: isPinned,
            onChanged: (value) => controller.updatePinnedStatus(value),
          ),
          
          const Divider(height: 24),
          
          // Clear Chat History
          _buildListTile(
            context,
            title: 'Clear Chat History',
            titleColor: theme.colorScheme.error,
            onTap: () => _showClearHistoryDialog(context, controller),
          ),
          
          // Leave
          _buildListTile(
            context,
            title: 'Leave',
            titleColor: theme.colorScheme.error,
            onTap: () => _showLeaveGroupDialog(context, controller),
          ),
        ],
      );
    });
  }
  
  Widget _buildMembersSection(BuildContext context, GroupInfoPanelController controller) {
    final theme = Theme.of(context);
    
    return Obx(() {
      final displayMembers = controller.members.take(4).toList();
      
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Wrap(
          spacing: 12,
          runSpacing: 8,
          children: [
            // Member avatars
            ...displayMembers.map((member) => _buildMemberAvatar(context, controller, member)),
            
            // Add button
            InkWell(
              onTap: () => _showInviteDialog(context, controller),
              borderRadius: BorderRadius.circular(8),
              child: Column(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      border: Border.all(color: theme.dividerColor, width: 1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(Icons.add, color: theme.colorScheme.onSurface.withValues(alpha: 0.5)),
                  ),
                  const SizedBox(height: 4),
                  const Text('Add', style: TextStyle(fontSize: 11)),
                ],
              ),
            ),
          ],
        ),
      );
    });
  }
  
  Widget _buildMemberAvatar(BuildContext context, GroupInfoPanelController controller, GroupMemberInfo member) {
    final displayName = member.nickname.isNotEmpty 
        ? member.nickname 
        : controller.truncateActorId(member.actorDid);
    
    return InkWell(
      onTap: () => _showMemberOptions(context, controller, member),
      borderRadius: BorderRadius.circular(8),
      child: Column(
        children: [
          Avatar(
            actorId: member.actorDid,
            fallbackName: displayName,
            size: 48,
          ),
          const SizedBox(height: 4),
          SizedBox(
            width: 48,
            child: Text(
              displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 11),
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildListTile(
    BuildContext context, {
    required String title,
    String? subtitle,
    Color? titleColor,
    Widget? trailing,
    VoidCallback? onTap,
  }) {
    final theme = Theme.of(context);
    
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: titleColor,
                    ),
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                      ),
                    ),
                ],
              ),
            ),
            if (trailing != null) trailing,
          ],
        ),
      ),
    );
  }
  
  Widget _buildSwitchTile(
    BuildContext context, {
    required String title,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(title, style: Theme.of(context).textTheme.bodyMedium),
          ),
          Switch(
            value: value,
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }
  
  // ==================== Dialogs ====================
  
  Future<void> _showEditNameDialog(BuildContext context, GroupInfoPanelController controller) async {
    final textController = TextEditingController(text: controller.group.value?.name ?? '');
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit Group Name'),
        content: TextField(
          controller: textController,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Group Name',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, textController.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    
    if (result != null && result.isNotEmpty) {
      controller.updateGroupName(result);
    }
  }
  
  Future<void> _showAnnouncementDialog(BuildContext context, GroupInfoPanelController controller) async {
    final textController = TextEditingController(text: controller.group.value?.description ?? '');
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Group Notice'),
        content: TextField(
          controller: textController,
          autofocus: true,
          maxLines: 5,
          decoration: const InputDecoration(
            labelText: 'Announcement',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, textController.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    
    if (result != null) {
      controller.updateAnnouncement(result);
    }
  }
  
  Future<void> _showEditNicknameDialog(BuildContext context, GroupInfoPanelController controller) async {
    final textController = TextEditingController(text: controller.myNickname);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('My Alias in Group'),
        content: TextField(
          controller: textController,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Nickname',
            hintText: 'Your nickname in this group',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, textController.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    
    if (result != null) {
      controller.updateMyNickname(result);
    }
  }
  
  void _showChatSearch(BuildContext context, GroupInfoPanelController controller, String? initialQuery) {
    showDialog(
      context: context,
      builder: (context) => ChatSearchDialog(groupUlid: groupUlid, initialQuery: initialQuery),
    );
  }
  
  Future<void> _showClearHistoryDialog(BuildContext context, GroupInfoPanelController controller) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear Chat History'),
        content: const Text('This will clear all messages in this chat. This action cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Clear'),
          ),
        ],
      ),
    );
    
    if (confirmed == true) {
      controller.clearHistory();
    }
  }
  
  Future<void> _showLeaveGroupDialog(BuildContext context, GroupInfoPanelController controller) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Leave Group'),
        content: const Text('Are you sure you want to leave this group? You will no longer receive messages.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Leave'),
          ),
        ],
      ),
    );
    
    if (confirmed == true) {
      controller.leaveGroup();
    }
  }
  
  Future<void> _showInviteDialog(BuildContext context, GroupInfoPanelController controller) async {
    final textController = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Invite Member'),
        content: TextField(
          controller: textController,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Actor DID',
            hintText: 'Enter the DID to invite',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, textController.text),
            child: const Text('Invite'),
          ),
        ],
      ),
    );
    
    if (result != null && result.isNotEmpty) {
      controller.inviteMember(result);
    }
  }
  
  void _showMemberOptions(BuildContext context, GroupInfoPanelController controller, GroupMemberInfo member) {
    showModalBottomSheet(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.person),
              title: Text(member.nickname.isNotEmpty ? member.nickname : member.actorDid),
              subtitle: Text('Joined ${controller.formatDate(member.joinedAt)}'),
            ),
            const Divider(),
            if (member.role == 3) // Owner
              const ListTile(
                leading: Icon(Icons.star, color: Colors.amber),
                title: Text('Group Owner'),
              ),
            if (member.role == 2) // Admin
              const ListTile(
                leading: Icon(Icons.admin_panel_settings, color: Colors.blue),
                title: Text('Admin'),
              ),
            ListTile(
              leading: const Icon(Icons.message),
              title: const Text('Send Message'),
              onTap: () {
                Navigator.pop(context);
                // TODO: Start private chat with this member
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// Chat search dialog
/// StatelessWidget per project convention (ADR-002)
class ChatSearchDialog extends StatelessWidget {
  const ChatSearchDialog({
    super.key,
    required this.groupUlid,
    this.initialQuery,
  });
  
  final String groupUlid;
  final String? initialQuery;

  @override
  Widget build(BuildContext context) {
    // Create controller for this dialog
    final controller = Get.put(
      ChatSearchDialogController(groupUlid: groupUlid, initialQuery: initialQuery),
    );
    
    return Dialog(
      child: Container(
        width: 400,
        height: 500,
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Text('Search Messages', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: controller.searchController,
                    autofocus: true,
                    decoration: const InputDecoration(
                      hintText: 'Enter search query',
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => controller.search(),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: controller.search,
                  child: const Text('Search'),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Expanded(
              child: Obx(() {
                if (controller.isLoading.value) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (controller.results.isEmpty) {
                  return const Center(child: Text('No results'));
                }
                return ListView.builder(
                  itemCount: controller.results.length,
                  itemBuilder: (context, index) {
                    final msg = controller.results[index];
                    return ListTile(
                      title: Text(msg.content, maxLines: 2, overflow: TextOverflow.ellipsis),
                      subtitle: Text(
                        DateTime.fromMillisecondsSinceEpoch(msg.sentAt * 1000).toString(),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      onTap: () {
                        Get.delete<ChatSearchDialogController>();
                        Navigator.pop(context);
                        // TODO: Jump to this message in chat
                      },
                    );
                  },
                );
              }),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () {
                Get.delete<ChatSearchDialogController>();
                Navigator.pop(context);
              },
              child: const Text('Close'),
            ),
          ],
        ),
      ),
    );
  }
}
