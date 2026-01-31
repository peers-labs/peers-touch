import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_base/widgets/avatar.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/friend_chat/controller/friend_chat_controller.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/chat_input_bar.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/chat_message_item.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/connection_debug_panel.dart';
import 'package:peers_touch_desktop/features/group_chat/view/create_group_dialog.dart';
import 'package:peers_touch_desktop/features/group_chat/view/group_list_panel.dart';
import 'package:peers_touch_desktop/features/group_chat/view/group_chat_panel.dart';
import 'package:peers_touch_desktop/features/shell/controller/right_panel_mode.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/shell/widgets/three_pane_scaffold.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';

/// Chat type filter for Messages page
enum ChatFilter { individual, group }

class FriendChatPage extends GetView<FriendChatController> {
  /// Selected chat filter (individual or group)
  static final selectedFilter = ChatFilter.individual.obs;
  const FriendChatPage({super.key});

  @override
  Widget build(BuildContext context) {
    return ShellThreePane(
      leftBuilder: (ctx) => _buildSessionList(ctx),
      centerBuilder: (ctx) => _buildChatPanel(ctx),
      leftProps: const PaneProps(
        width: UIKit.secondaryNavWidth,
        minWidth: 220,
        maxWidth: 360,
        scrollPolicy: ScrollPolicy.none,
        horizontalPolicy: ScrollPolicy.none,
      ),
      centerProps: const PaneProps(
        scrollPolicy: ScrollPolicy.none,
        horizontalPolicy: ScrollPolicy.none,
      ),
    );
  }

  Widget _buildSessionList(BuildContext context) {
    return Container(
      color: UIKit.assistantSidebarBg(context),
      child: Column(
        children: [
          // Search bar with create button
          Container(
            height: UIKit.topBarHeight,
            padding: EdgeInsets.symmetric(horizontal: UIKit.spaceMd(context)),
            child: Row(
              children: [
                Expanded(
                  child: SearchInput(
                    hintText: 'Search...',
                    fillColor: UIKit.inputFillLight(context),
                    borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                  ),
                ),
                const SizedBox(width: 8),
                Obx(() => selectedFilter.value == ChatFilter.group
                    ? IconButton(
                        icon: const Icon(Icons.add),
                        tooltip: 'Create Group',
                        onPressed: () => _showCreateGroupDialog(context),
                      )
                    : const SizedBox.shrink()),
              ],
            ),
          ),
          // Filter Chips
          Padding(
            padding: EdgeInsets.symmetric(
              horizontal: UIKit.spaceMd(context),
              vertical: UIKit.spaceXs(context),
            ),
            child: Obx(() => Row(
              children: [
                _buildFilterChip(
                  context,
                  label: 'Individual',
                  icon: Icons.person,
                  selected: selectedFilter.value == ChatFilter.individual,
                  onSelected: () => selectedFilter.value = ChatFilter.individual,
                ),
                const SizedBox(width: 8),
                _buildFilterChip(
                  context,
                  label: 'Groups',
                  icon: Icons.group,
                  selected: selectedFilter.value == ChatFilter.group,
                  onSelected: () => selectedFilter.value = ChatFilter.group,
                ),
              ],
            )),
          ),
          Divider(
            height: UIKit.spaceLg(context),
            thickness: UIKit.dividerThickness,
            color: UIKit.dividerColor(context),
          ),
          // Session/Group list based on filter
          Expanded(
            child: Obx(() {
              if (selectedFilter.value == ChatFilter.group) {
                return const GroupListPanel();
              }
              return _buildFriendList(context);
            }),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(
    BuildContext context, {
    required String label,
    required IconData icon,
    required bool selected,
    required VoidCallback onSelected,
  }) {
    final theme = Theme.of(context);
    return FilterChip(
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16),
          const SizedBox(width: 4),
          Text(label),
        ],
      ),
      selected: selected,
      onSelected: (_) => onSelected(),
      showCheckmark: false,
      selectedColor: theme.colorScheme.primaryContainer,
      backgroundColor: theme.colorScheme.surfaceContainerHighest,
      side: BorderSide.none,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    );
  }

  void _showCreateGroupDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => const CreateGroupDialog(),
    );
  }

  Widget _buildFriendList(BuildContext context) {
    return Obx(() {
      if (controller.isLoading.value) {
        return const Center(
          child: CircularProgressIndicator(),
        );
      }

      final friendList = controller.friends.toList();
      
      if (friendList.isEmpty) {
        return Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.people_outline,
                size: 64,
                color: Colors.grey.shade400,
              ),
              const SizedBox(height: 16),
              Text(
                'No friends yet',
                style: TextStyle(
                  fontSize: 16,
                  color: Colors.grey.shade600,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Follow friends to start chatting',
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.grey.shade500,
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: controller.refreshSessions,
                icon: const Icon(Icons.refresh),
                label: const Text('Refresh'),
              ),
            ],
          ),
        );
      }

      final currentFriendId = controller.currentFriend.value?.actorId;
      return ListView.separated(
        itemCount: friendList.length,
        separatorBuilder: (_, index) => Divider(
          height: 1,
          color: UIKit.dividerColor(context),
        ),
        itemBuilder: (context, index) {
          final friend = friendList[index];
          final isSelected = friend.actorId == currentFriendId;
          return ListTile(
            leading: Avatar(
              actorId: friend.actorId,
              avatarUrl: friend.avatarUrl,
              fallbackName: friend.name,
              size: 40,
            ),
            title: Text(friend.name),
            subtitle: Text('@${friend.username}'),
            selected: isSelected,
            onTap: () => controller.selectFriend(friend),
          );
        },
      );
    });
  }

  Widget _buildChatPanel(BuildContext context) {
    return Obx(() {
      if (selectedFilter.value == ChatFilter.group) {
        return const GroupChatPanel();
      }
      return _buildFriendChatPanel(context);
    });
  }

  Widget _buildFriendChatPanel(BuildContext context) {
    return Container(
      color: UIKit.chatAreaBg(context),
      child: Column(
        children: [
          _buildChatHeader(context),
          Divider(
            height: UIKit.spaceLg(context),
            thickness: UIKit.dividerThickness,
            color: UIKit.dividerColor(context),
          ),
          Expanded(
            child: Obx(() {
              final messageList = controller.messages.toList();
              if (messageList.isEmpty) {
                return Center(
                  child: Text(
                    'No messages yet',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: UIKit.textSecondary(context),
                        ),
                  ),
                );
              }
              final currentSession = controller.currentSession.value;
              final remoteName = currentSession?.topic ?? 'User';
              return ListView.builder(
                padding: EdgeInsets.all(UIKit.spaceMd(context)),
                itemCount: messageList.length,
                itemBuilder: (context, index) {
                  final message = messageList[index];
                  final isMe = message.senderId == controller.currentUserId;
                  return ChatMessageItem(
                    message: message,
                    isMe: isMe,
                    senderName: isMe ? controller.currentUserName : remoteName,
                    senderAvatarUrl: isMe ? controller.currentUserAvatarUrl : null,
                  );
                },
              );
            }),
          ),
          Obx(() {
            final err = controller.error.value;
            if (err == null) return const SizedBox.shrink();
            return Padding(
              padding: EdgeInsets.symmetric(
                horizontal: UIKit.spaceMd(context),
                vertical: UIKit.spaceXs(context),
              ),
              child: Text(
                err,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: UIKit.errorColor(context)),
              ),
            );
          }),
          FriendChatInputBar(
            controller: controller.inputController,
            onSend: () {
              final text = controller.inputController.text;
              controller.sendMessage(text);
            },
            isSending: controller.isSending.value,
          ),
        ],
      ),
    );
  }

  Widget _buildChatHeader(BuildContext context) {
    _injectDebugPanel(context);

    return Container(
      height: UIKit.topBarHeight,
      padding: EdgeInsets.symmetric(horizontal: UIKit.spaceMd(context)),
      child: Row(
        children: [
          Obx(() {
            final session = controller.currentSession.value;
            final connMode = controller.connectionMode.value;
            final l10n = AppLocalizations.of(context)!;
            String statusText = '';
            Color statusColor = UIKit.textSecondary(context);
            
            if (session != null) {
              if (session.participantIds.length > 2) {
                statusText = '${session.participantIds.length} members';
              } else {
                if (connMode == ConnectionMode.p2pDirect) {
                  statusText = l10n.connectionStatusOnlineP2P;
                  statusColor = Colors.green;
                } else if (connMode == ConnectionMode.stationRelay) {
                  statusText = l10n.connectionStatusOnlineRelay;
                  statusColor = Colors.blue;
                } else {
                  statusText = l10n.connectionStatusOffline;
                  statusColor = UIKit.textSecondary(context);
                }
              }
            }
            
            return Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session?.topic ?? 'Select a chat',
                    style: Theme.of(context).textTheme.titleMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (statusText.isNotEmpty)
                    Text(
                      statusText,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: statusColor,
                          ),
                    ),
                ],
              ),
            );
          }),
          IconButton(
            icon: const Icon(Icons.bug_report_outlined),
            tooltip: 'P2P Debug Panel',
            onPressed: () {
              final shell = Get.find<ShellController>();
              shell.toggleRightPanel();
            },
          ),
          IconButton(
            icon: const Icon(Icons.more_vert),
            onPressed: () {},
          ),
        ],
      ),
    );
  }

  void _injectDebugPanel(BuildContext context) {
    final shell = Get.find<ShellController>();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (shell.rightPanelBuilder.value == null) {
        shell.openRightPanelWithOptions(
          (ctx) => Obx(() => ConnectionDebugPanel(
                stats: controller.connectionStats.value,
                onRefresh: controller.refreshConnectionStats,
                onConnect: controller.connect,
                onDisconnect: controller.disconnect,
              )),
          width: UIKit.rightPanelWidth,
          showCollapseButton: true,
          clearCenter: false,
          collapsedByDefault: true,
          mode: RightPanelMode.squeeze,
        );
      }
    });
  }
}
