import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/network/group_chat/group_chat_api_service.dart';
import 'package:peers_touch_base/storage/chat/chat_cache_service.dart';
import 'package:peers_touch_base/widgets/avatar.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/friend_chat/controller/friend_chat_controller.dart';

/// 微信风格的群信息侧边面板
// MYQ: 不要有硬编码 这里有必要用 statefull吗
class GroupInfoPanel extends StatefulWidget {
  const GroupInfoPanel({
    super.key,
    required this.groupUlid,
    required this.onClose,
  });

  final String groupUlid;
  final VoidCallback onClose;

  @override
  State<GroupInfoPanel> createState() => _GroupInfoPanelState();
}

class _GroupInfoPanelState extends State<GroupInfoPanel> {
  final _api = GroupChatApiService();
  final _searchController = TextEditingController();
  
  GroupInfo? _group;
  List<GroupMemberInfo> _members = [];
  Map<String, dynamic> _mySettings = {};
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    
    try {
      // Load group info and members (required)
      final groupFuture = _api.getGroupInfo(widget.groupUlid);
      final membersFuture = _api.getMembers(widget.groupUlid);
      
      final results = await Future.wait([groupFuture, membersFuture]);
      
      _group = results[0] as GroupInfo;
      _members = results[1] as List<GroupMemberInfo>;
      
      // Load settings separately (optional, may fail)
      try {
        _mySettings = await _api.getMySettings(widget.groupUlid);
      } catch (_) {
        // Settings API may not be fully implemented, use defaults
        _mySettings = {
          'is_muted': false,
          'is_pinned': false,
          'my_nickname': '',
        };
      }
      
      setState(() {
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
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
          _buildSearchBar(context),
          const Divider(height: 1),
          
          // Content
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)))
                    : _buildContent(context),
          ),
        ],
      ),
    );
  }
  
  Widget _buildSearchBar(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(8),
      child: TextField(
        controller: _searchController,
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
        onSubmitted: (query) => _searchMessages(query),
      ),
    );
  }
  
  Widget _buildContent(BuildContext context) {
    final theme = Theme.of(context);
    final myNickname = _mySettings['my_nickname'] as String? ?? '';
    final isMuted = _mySettings['is_muted'] as bool? ?? false;
    final isPinned = _mySettings['is_pinned'] as bool? ?? false;
    
    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      children: [
        // Members section
        _buildMembersSection(context),
        const SizedBox(height: 12),
        
        // Group Name
        _buildListTile(
          context,
          title: 'Group Name',
          subtitle: _group?.name ?? '',
          onTap: () => _showEditNameDialog(context),
        ),
        
        // Group Notice
        _buildListTile(
          context,
          title: 'Group Notice',
          subtitle: _group?.description.isNotEmpty == true 
              ? _group!.description 
              : 'Not set by group owner',
          onTap: () => _showAnnouncementDialog(context),
        ),
        
        // My Alias in Group
        _buildListTile(
          context,
          title: 'My Alias in Group',
          subtitle: myNickname.isNotEmpty ? myNickname : 'Not set',
          onTap: () => _showEditNicknameDialog(context),
        ),
        
        const Divider(height: 24),
        
        // Search Chat History
        _buildListTile(
          context,
          title: 'Search Chat History',
          trailing: const Icon(Icons.chevron_right, size: 20),
          onTap: () => _showChatSearch(context),
        ),
        
        const Divider(height: 24),
        
        // Mute Notifications
        _buildSwitchTile(
          context,
          title: 'Mute Notifications',
          value: isMuted,
          onChanged: (value) => _updateMuteStatus(value),
        ),
        
        // Sticky
        _buildSwitchTile(
          context,
          title: 'Sticky',
          value: isPinned,
          onChanged: (value) => _updatePinnedStatus(value),
        ),
        
        const Divider(height: 24),
        
        // Clear Chat History
        _buildListTile(
          context,
          title: 'Clear Chat History',
          titleColor: theme.colorScheme.error,
          onTap: () => _showClearHistoryDialog(context),
        ),
        
        // Leave
        _buildListTile(
          context,
          title: 'Leave',
          titleColor: theme.colorScheme.error,
          onTap: () => _showLeaveGroupDialog(context),
        ),
      ],
    );
  }
  
  Widget _buildMembersSection(BuildContext context) {
    final theme = Theme.of(context);
    final displayMembers = _members.take(4).toList();
    
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Wrap(
        spacing: 12,
        runSpacing: 8,
        children: [
          // Member avatars
          ...displayMembers.map((member) => _buildMemberAvatar(context, member)),
          
          // Add button
          InkWell(
            onTap: () => _showInviteDialog(context),
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
  }
  
  Widget _buildMemberAvatar(BuildContext context, GroupMemberInfo member) {
    final displayName = member.nickname.isNotEmpty 
        ? member.nickname 
        : _truncateActorId(member.actorDid);
    
    return InkWell(
      onTap: () => _showMemberOptions(context, member),
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
  
  String _truncateActorId(String actorId) {
    if (actorId.length <= 8) return actorId;
    return '${actorId.substring(0, 8)}...';
  }
  
  // ==================== Actions ====================
  
  Future<void> _showEditNameDialog(BuildContext context) async {
    final controller = TextEditingController(text: _group?.name ?? '');
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit Group Name'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Group Name',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    
    if (result != null && result.isNotEmpty && result != _group?.name) {
      try {
        await _api.updateGroup(groupUlid: widget.groupUlid, name: result);
        _loadData();
        Get.snackbar('Success', 'Group name updated');
      } catch (e) {
        Get.snackbar('Error', 'Failed to update group name: $e');
      }
    }
  }
  
  Future<void> _showAnnouncementDialog(BuildContext context) async {
    final controller = TextEditingController(text: _group?.description ?? '');
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Group Notice'),
        content: TextField(
          controller: controller,
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
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    
    if (result != null && result != _group?.description) {
      try {
        await _api.updateGroup(groupUlid: widget.groupUlid, description: result);
        _loadData();
        Get.snackbar('Success', 'Announcement updated');
      } catch (e) {
        Get.snackbar('Error', 'Failed to update announcement: $e');
      }
    }
  }
  
  Future<void> _showEditNicknameDialog(BuildContext context) async {
    final currentNickname = _mySettings['my_nickname'] as String? ?? '';
    final controller = TextEditingController(text: currentNickname);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('My Alias in Group'),
        content: TextField(
          controller: controller,
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
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    
    if (result != null && result != currentNickname) {
      try {
        await _api.updateMyNickname(groupUlid: widget.groupUlid, nickname: result);
        _loadData();
        Get.snackbar('Success', 'Nickname updated');
      } catch (e) {
        Get.snackbar('Error', 'Failed to update nickname: $e');
      }
    }
  }
  
  void _showChatSearch(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => _ChatSearchDialog(groupUlid: widget.groupUlid),
    );
  }
  
  Future<void> _updateMuteStatus(bool muted) async {
    try {
      await _api.updateMySettings(groupUlid: widget.groupUlid, isMuted: muted);
      setState(() {
        _mySettings['is_muted'] = muted;
      });
    } catch (e) {
      Get.snackbar('Error', 'Failed to update mute status: $e');
    }
  }
  
  Future<void> _updatePinnedStatus(bool pinned) async {
    try {
      await _api.updateMySettings(groupUlid: widget.groupUlid, isPinned: pinned);
      setState(() {
        _mySettings['is_pinned'] = pinned;
      });
      // Notify controller to refresh session list
      Get.find<FriendChatController>().refreshSessions();
    } catch (e) {
      Get.snackbar('Error', 'Failed to update pinned status: $e');
    }
  }
  
  Future<void> _showClearHistoryDialog(BuildContext context) async {
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
      // Clear local messages in controller
      final controller = Get.find<FriendChatController>();
      controller.groupMessages.clear();
      
      // Clear unread count from cache
      try {
        final cache = ChatCacheService.instance;
        await cache.clearUnreadCount(widget.groupUlid);
      } catch (e) {
        // Cache might not be initialized
      }
      
      Get.snackbar('Success', 'Chat history cleared');
    }
  }
  
  Future<void> _showLeaveGroupDialog(BuildContext context) async {
    // Check if user is owner
    final isOwner = _group?.ownerDid == Get.find<FriendChatController>().currentUserId;
    
    if (isOwner) {
      Get.snackbar('Cannot Leave', 'Group owner cannot leave. Transfer ownership first or delete the group.');
      return;
    }
    
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
      try {
        await _api.leaveGroup(widget.groupUlid);
        Get.snackbar('Success', 'Left group');
        widget.onClose();
        Get.find<FriendChatController>().refreshSessions();
      } catch (e) {
        Get.snackbar('Error', 'Failed to leave group: $e');
      }
    }
  }
  
  Future<void> _showInviteDialog(BuildContext context) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Invite Member'),
        content: TextField(
          controller: controller,
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
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('Invite'),
          ),
        ],
      ),
    );
    
    if (result != null && result.isNotEmpty) {
      try {
        await _api.inviteToGroup(widget.groupUlid, [result]);
        Get.snackbar('Success', 'Invitation sent');
        _loadData();
      } catch (e) {
        Get.snackbar('Error', 'Failed to invite: $e');
      }
    }
  }
  
  void _showMemberOptions(BuildContext context, GroupMemberInfo member) {
    showModalBottomSheet(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.person),
              title: Text(member.nickname.isNotEmpty ? member.nickname : member.actorDid),
              subtitle: Text('Joined ${_formatDate(member.joinedAt)}'),
            ),
            const Divider(),
            if (member.role == 3) // Owner
              ListTile(
                leading: const Icon(Icons.star, color: Colors.amber),
                title: const Text('Group Owner'),
              ),
            if (member.role == 2) // Admin
              ListTile(
                leading: const Icon(Icons.admin_panel_settings, color: Colors.blue),
                title: const Text('Admin'),
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
  
  void _searchMessages(String query) {
    if (query.isEmpty) return;
    showDialog(
      context: context,
      builder: (context) => _ChatSearchDialog(groupUlid: widget.groupUlid, initialQuery: query),
    );
  }
  
  String _formatDate(int timestamp) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp * 1000);
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
  }
}

/// Chat search dialog
class _ChatSearchDialog extends StatefulWidget {
  const _ChatSearchDialog({
    required this.groupUlid,
    this.initialQuery,
  });
  
  final String groupUlid;
  final String? initialQuery;

  @override
  State<_ChatSearchDialog> createState() => _ChatSearchDialogState();
}

class _ChatSearchDialogState extends State<_ChatSearchDialog> {
  final _api = GroupChatApiService();
  final _controller = TextEditingController();
  List<GroupMessageInfo> _results = [];
  bool _isLoading = false;
  
  @override
  void initState() {
    super.initState();
    if (widget.initialQuery != null) {
      _controller.text = widget.initialQuery!;
      _search();
    }
  }
  
  Future<void> _search() async {
    final query = _controller.text.trim();
    if (query.isEmpty) return;
    
    setState(() => _isLoading = true);
    
    try {
      final results = await _api.searchMessages(groupUlid: widget.groupUlid, query: query);
      setState(() {
        _results = results;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      Get.snackbar('Error', 'Search failed: $e');
    }
  }
  
  @override
  Widget build(BuildContext context) {
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
                    controller: _controller,
                    autofocus: true,
                    decoration: const InputDecoration(
                      hintText: 'Enter search query',
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => _search(),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _search,
                  child: const Text('Search'),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : _results.isEmpty
                      ? const Center(child: Text('No results'))
                      : ListView.builder(
                          itemCount: _results.length,
                          itemBuilder: (context, index) {
                            final msg = _results[index];
                            return ListTile(
                              title: Text(msg.content, maxLines: 2, overflow: TextOverflow.ellipsis),
                              subtitle: Text(
                                DateTime.fromMillisecondsSinceEpoch(msg.sentAt * 1000).toString(),
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                              onTap: () {
                                Navigator.pop(context);
                                // TODO: Jump to this message in chat
                              },
                            );
                          },
                        ),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close'),
            ),
          ],
        ),
      ),
    );
  }
}
