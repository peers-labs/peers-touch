import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_base/model/domain/chat/group_chat.pb.dart';
import 'package:peers_touch_base/network/group_chat/group_chat_api_service.dart';
import 'package:peers_touch_base/widgets/avatar.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/friend_chat/controller/friend_chat_controller.dart';
import 'package:peers_touch_desktop/features/friend_chat/model/unified_session.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/chat_input_bar.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/chat_message_item.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/connection_debug_panel.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/group_avatar_mosaic.dart';
import 'package:peers_touch_desktop/features/friend_chat/view/group_info_page.dart';
import 'package:peers_touch_desktop/features/friend_chat/view/group_info_panel.dart';
import 'package:peers_touch_desktop/features/group_chat/view/create_group_dialog.dart';
import 'package:peers_touch_desktop/features/group_chat/widgets/group_message_bubble.dart';
import 'package:peers_touch_desktop/features/shell/controller/right_panel_mode.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/shell/widgets/three_pane_scaffold.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';

class FriendChatPage extends GetView<FriendChatController> {
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
          // Search bar with create group button
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
                IconButton(
                  icon: const Icon(Icons.group_add),
                  tooltip: '创建群组',
                  onPressed: () => _showCreateGroupDialog(context),
                ),
              ],
            ),
          ),
          Divider(
            height: 1,
            thickness: UIKit.dividerThickness,
            color: UIKit.dividerColor(context),
          ),
          // Unified session list (individuals + groups mixed)
          Expanded(
            child: _buildUnifiedList(context),
          ),
        ],
      ),
    );
  }

  void _showCreateGroupDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => const CreateGroupDialog(),
    ).then((_) {
      // Refresh sessions after dialog closes
      controller.refreshAllSessions();
    });
  }

  Widget _buildUnifiedList(BuildContext context) {
    return Obx(() {
      if (controller.isLoading.value) {
        return Center(
          child: SizedBox(
            width: UIKit.indicatorSizeSm,
            height: UIKit.indicatorSizeSm,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: Theme.of(context).colorScheme.primary,
            ),
          ),
        );
      }

      final sessionList = controller.unifiedSessions.toList();

      if (sessionList.isEmpty) {
        return _buildEmptyState(context);
      }

      final currentId = controller.currentUnifiedSession.value?.id;
      return ListView.separated(
        padding: EdgeInsets.symmetric(vertical: UIKit.spaceXs(context)),
        itemCount: sessionList.length,
        separatorBuilder: (_, __) => Divider(
          height: 1,
          thickness: UIKit.dividerThickness,
          color: UIKit.dividerColor(context),
          indent: UIKit.spaceLg(context) + 40 + UIKit.spaceSm(context),
        ),
        itemBuilder: (context, index) {
          final session = sessionList[index];
          final isSelected = session.id == currentId;
          return _UnifiedSessionTile(
            session: session,
            isSelected: isSelected,
            onTap: () => controller.selectUnifiedSession(session),
          );
        },
      );
    });
  }

  Widget _buildEmptyState(BuildContext context) {
    return Center(
      child: Padding(
        padding: EdgeInsets.all(UIKit.spaceLg(context)),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
              ),
              child: Icon(
                Icons.chat_bubble_outline,
                size: 32,
                color: UIKit.textSecondary(context),
              ),
            ),
            SizedBox(height: UIKit.spaceLg(context)),
            Text(
              '暂无会话',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: UIKit.textPrimary(context),
                  ),
            ),
            SizedBox(height: UIKit.spaceXs(context)),
            Text(
              '关注好友或创建群组开始聊天',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: UIKit.textSecondary(context),
                  ),
            ),
            SizedBox(height: UIKit.spaceLg(context)),
            FilledButton.icon(
              onPressed: controller.refreshAllSessions,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('刷新'),
              style: UIKit.primaryButtonStyle(context),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildChatPanel(BuildContext context) {
    return Obx(() {
      final session = controller.currentUnifiedSession.value;
      if (session == null) {
        return _buildNoChatSelected(context);
      }

      if (session.isGroup) {
        return _buildGroupChatPanel(context);
      }
      return _buildFriendChatPanel(context);
    });
  }

  Widget _buildNoChatSelected(BuildContext context) {
    return Container(
      color: UIKit.chatAreaBg(context),
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
              ),
              child: Icon(
                Icons.chat_outlined,
                size: 32,
                color: UIKit.textSecondary(context),
              ),
            ),
            SizedBox(height: UIKit.spaceLg(context)),
            Text(
              '选择一个会话开始聊天',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: UIKit.textPrimary(context),
                  ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGroupChatPanel(BuildContext context) {
    final group = controller.currentGroup.value;

    return Obx(() => Row(
      children: [
        // Main chat area
        Expanded(
          child: Container(
            color: UIKit.chatAreaBg(context),
            child: Column(
              children: [
                _buildGroupHeader(context, group),
                Divider(
                  height: 1,
                  thickness: UIKit.dividerThickness,
                  color: UIKit.dividerColor(context),
                ),
                Expanded(
                  child: Stack(
                    children: [
                      Obx(() {
                        final allMessages = controller.groupMessages.toList();
                        // Filter out reply messages - they should only show in thread card
                        final topLevelMessages = allMessages.where((m) => 
                            m.replyToUlid == null || m.replyToUlid!.isEmpty
                        ).toList();
                        
                        if (topLevelMessages.isEmpty) {
                          return Center(
                            child: Text(
                              '暂无消息',
                              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                    color: UIKit.textSecondary(context),
                                  ),
                            ),
                          );
                        }
                        final groupUlid = controller.currentGroup.value?.ulid ?? '';
                        final myUserId = controller.currentUserId;
                        return ListView.builder(
                          key: ValueKey('group_messages_$groupUlid'),
                          controller: controller.groupMessageScrollController,
                          padding: EdgeInsets.all(UIKit.spaceMd(context)),
                          itemCount: topLevelMessages.length,
                          itemBuilder: (context, index) {
                            final message = topLevelMessages[index];
                            final isMe = message.senderDid == myUserId;
                            final senderName = isMe 
                                ? controller.currentUserName 
                                : controller.getMemberDisplayName(groupUlid, message.senderDid);
                            // Get replies to this message
                            final replies = allMessages.where((m) => m.replyToUlid == message.ulid).toList();
                            return _buildGroupMessageWithThreadPreview(
                              context,
                              message: message,
                              isMe: isMe,
                              senderName: senderName,
                              replies: replies,
                              allMessages: allMessages,
                              key: ValueKey(message.ulid),
                            );
                          },
                        );
                      }),
                      // "Scroll to latest" banner - shown when user is viewing history
                      Obx(() {
                        if (!controller.showScrollToLatest.value) {
                          return const SizedBox.shrink();
                        }
                        final l10n = AppLocalizations.of(context)!;
                        return Positioned(
                          left: 0,
                          right: 0,
                          bottom: 0,
                          child: _ScrollToLatestBanner(
                            text: l10n.scrollToLatest,
                            onTap: controller.scrollGroupToLatest,
                          ),
                        );
                      }),
                    ],
                  ),
                ),
                Obx(() {
                  final err = controller.error.value;
                  if (err == null) return const SizedBox.shrink();
                  return Container(
                    width: double.infinity,
                    padding: EdgeInsets.symmetric(
                      horizontal: UIKit.spaceMd(context),
                      vertical: UIKit.spaceXs(context),
                    ),
                    color: UIKit.errorColor(context).withValues(alpha: 0.1),
                    child: Text(
                      err,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: UIKit.errorColor(context),
                          ),
                    ),
                  );
                }),
                Divider(
                  height: 1,
                  thickness: UIKit.dividerThickness,
                  color: UIKit.dividerColor(context),
                ),
                Obx(() => FriendChatInputBar(
                  controller: controller.inputController,
                  onSend: () {
                    final text = controller.inputController.text;
                    controller.sendGroupMessage(text);
                  },
                  isSending: controller.isSending.value,
                  showEmojiPicker: controller.showEmojiPicker.value,
                  onToggleEmojiPicker: controller.toggleEmojiPicker,
                  onAttachmentTap: controller.pickAttachment,
                  onAddCustomSticker: controller.addCustomSticker,
                )),
              ],
            ),
          ),
        ),
        
        // Thread panel (Slack-style)
        if (controller.showThreadPanel.value)
          _buildThreadPanel(context),
        
        // Group info panel (WeChat-style)
        if (controller.showGroupInfoPanel.value && controller.currentGroup.value != null)
          GroupInfoPanel(
            groupUlid: controller.currentGroup.value!.ulid,
            onClose: controller.closeGroupInfoPanel,
          ),
      ],
    ));
  }
  
  /// Build a group message with thread preview card
  Widget _buildGroupMessageWithThreadPreview(
    BuildContext context, {
    required GroupMessageInfo message,
    required bool isMe,
    required String senderName,
    required List<GroupMessageInfo> replies,
    required List<GroupMessageInfo> allMessages,
    Key? key,
  }) {
    final theme = Theme.of(context);
    final groupUlid = controller.currentGroup.value?.ulid ?? '';
    const maxPreviewReplies = 5;
    final previewReplies = replies.take(maxPreviewReplies).toList();
    final hasMoreReplies = replies.length > maxPreviewReplies;
    
    return Column(
      key: key,
      crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        GroupMessageBubble(
          message: message,
          isMe: isMe,
          senderName: senderName,
          senderActorId: message.senderDid,
          onReply: () => controller.openThread(message),
        ),
        // Thread preview card
        if (replies.isNotEmpty)
          Container(
            margin: EdgeInsets.only(
              left: isMe ? 60 : 52,
              right: isMe ? 0 : 60,
              top: 4,
              bottom: 8,
            ),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(8),
              border: Border(
                left: BorderSide(
                  color: theme.colorScheme.primary,
                  width: 3,
                ),
              ),
            ),
            child: InkWell(
              onTap: () => controller.openThread(message),
              borderRadius: BorderRadius.circular(8),
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Preview replies
                    ...previewReplies.map((reply) {
                      final replyerName = reply.senderDid == controller.currentUserId
                          ? controller.currentUserName
                          : controller.getMemberDisplayName(groupUlid, reply.senderDid);
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '$replyerName: ',
                              style: theme.textTheme.bodySmall?.copyWith(
                                fontWeight: FontWeight.w600,
                                color: theme.colorScheme.primary,
                              ),
                            ),
                            Expanded(
                              child: Text(
                                reply.content,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.bodySmall,
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                    // Show more indicator
                    if (hasMoreReplies)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          '${replies.length - maxPreviewReplies} more replies...',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.primary,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    // Reply count footer
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        '${replies.length} ${replies.length == 1 ? 'reply' : 'replies'}',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
  
  /// Build Thread panel (Slack-style)
  Widget _buildThreadPanel(BuildContext context) {
    final parent = controller.threadParentMessage.value;
    if (parent == null) return const SizedBox.shrink();
    
    final groupUlid = controller.currentGroup.value?.ulid ?? '';
    
    return ThreadPanel(
      thread: ThreadData(
        parentMessage: ThreadMessage(
          id: parent.ulid,
          senderId: parent.senderDid,
          senderName: parent.senderDid == controller.currentUserId
              ? controller.currentUserName
              : controller.getMemberDisplayName(groupUlid, parent.senderDid),
          content: parent.content,
          sentAt: DateTime.fromMillisecondsSinceEpoch(parent.sentAt * 1000),
        ),
        replies: controller.threadReplies.map((r) => ThreadMessage(
          id: r.ulid,
          senderId: r.senderDid,
          senderName: r.senderDid == controller.currentUserId
              ? controller.currentUserName
              : controller.getMemberDisplayName(groupUlid, r.senderDid),
          content: r.content,
          sentAt: DateTime.fromMillisecondsSinceEpoch(r.sentAt * 1000),
        )).toList(),
        replyCount: controller.threadReplies.length,
      ),
      currentUserId: controller.currentUserId,
      inputController: controller.threadInputController,
      isSending: controller.isSending.value,
      onClose: controller.closeThread,
      onSendReply: controller.sendThreadReply,
    );
  }

  Widget _buildGroupHeader(BuildContext context, GroupInfo? group) {
    final theme = Theme.of(context);

    return Container(
      height: UIKit.topBarHeight,
      padding: EdgeInsets.symmetric(horizontal: UIKit.spaceMd(context)),
      child: Row(
        children: [
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  group?.name ?? '选择群组',
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: UIKit.textPrimary(context),
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (group != null) ...[
                  SizedBox(height: UIKit.spaceXs(context) / 2),
                  Text(
                    '${group.memberCount} 人',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: UIKit.textSecondary(context),
                    ),
                  ),
                ],
              ],
            ),
          ),
          IconButton(
            icon: Icon(Icons.info_outline, color: UIKit.textSecondary(context)),
            tooltip: '群组信息',
            onPressed: group != null ? controller.toggleGroupInfoPanel : null,
          ),
        ],
      ),
    );
  }

  Widget _buildFriendChatPanel(BuildContext context) {
    return Container(
      color: UIKit.chatAreaBg(context),
      child: Column(
        children: [
          _buildChatHeader(context),
          Divider(
            height: 1,
            thickness: UIKit.dividerThickness,
            color: UIKit.dividerColor(context),
          ),
          Expanded(
            child: Obx(() {
              final messageList = controller.messages.toList();
              if (messageList.isEmpty) {
                return Center(
                  child: Text(
                    '暂无消息',
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
                    onReply: () => controller.startReply(message),
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
          Obx(() {
            final replyMsg = controller.replyingToMessage.value;
            ReplyMessage? replyPreview;
            if (replyMsg != null) {
              replyPreview = ReplyMessage(
                id: replyMsg.id,
                senderName: replyMsg.senderId == controller.currentUserId 
                    ? controller.currentUserName 
                    : (controller.currentSession.value?.topic ?? 'User'),
                content: replyMsg.content,
              );
            }
            return FriendChatInputBar(
              controller: controller.inputController,
              onSend: () {
                final text = controller.inputController.text;
                controller.sendMessage(text);
                controller.cancelReply();
              },
              isSending: controller.isSending.value,
              showEmojiPicker: controller.showEmojiPicker.value,
              onToggleEmojiPicker: controller.toggleEmojiPicker,
              replyMessage: replyPreview,
              onCancelReply: controller.cancelReply,
              onAttachmentTap: controller.pickAttachment,
              onAddCustomSticker: controller.addCustomSticker,
            );
          }),
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

/// Unified session list item (supports both individual and group chats)
class _UnifiedSessionTile extends StatelessWidget {
  final UnifiedSession session;
  final bool isSelected;
  final VoidCallback onTap;

  const _UnifiedSessionTile({
    required this.session,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Material(
      color: isSelected
          ? theme.colorScheme.primaryContainer.withValues(alpha: 0.3)
          : Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: UIKit.spaceLg(context),
            vertical: UIKit.spaceSm(context),
          ),
          child: Row(
            children: [
              _buildAvatar(context),
              SizedBox(width: UIKit.spaceSm(context)),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        if (session.isGroup)
                          Padding(
                            padding: EdgeInsets.only(right: UIKit.spaceXs(context)),
                            child: Icon(
                              Icons.group,
                              size: 14,
                              color: UIKit.textSecondary(context),
                            ),
                          ),
                        Expanded(
                          child: Text(
                            session.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: UIKit.textPrimary(context),
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                        if (session.lastMessageTime != null)
                          Text(
                            _formatTime(session.lastMessageTime!),
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: UIKit.textSecondary(context),
                              fontSize: 11,
                            ),
                          ),
                      ],
                    ),
                    SizedBox(height: UIKit.spaceXs(context) / 2),
                    Text(
                      session.lastMessage ?? session.subtitle ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: UIKit.textSecondary(context),
                      ),
                    ),
                  ],
                ),
              ),
              if (session.unreadCount > 0)
                Container(
                  margin: EdgeInsets.only(left: UIKit.spaceSm(context)),
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.error,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    session.unreadCount > 99 ? '99+' : '${session.unreadCount}',
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onError,
                      fontSize: 10,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAvatar(BuildContext context) {
    if (session.isGroup && session.memberAvatarUrls != null && session.memberAvatarUrls!.isNotEmpty) {
      // Use mosaic avatar for groups with member avatars
      return GroupAvatarMosaic(
        memberIds: List.generate(session.memberAvatarUrls!.length, (i) => 'member_$i'),
        memberAvatarUrls: session.memberAvatarUrls!,
        size: 44,
      );
    }

    if (session.isGroup) {
      // Fallback group avatar
      final colorIndex = session.name.hashCode.abs() % Colors.primaries.length;
      final bgColor = Colors.primaries[colorIndex].withValues(alpha: 0.2);
      final fgColor = Colors.primaries[colorIndex];

      return Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
        ),
        child: Center(
          child: Icon(Icons.group, color: fgColor, size: 22),
        ),
      );
    }

    // Individual avatar
    final friend = session.originalData as FriendItem?;
    return Avatar(
      actorId: session.id,
      avatarUrl: session.avatarUrl,
      fallbackName: friend?.name ?? session.name,
      size: 44,
    );
  }

  String _formatTime(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);

    if (diff.inDays == 0) {
      return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } else if (diff.inDays == 1) {
      return '昨天';
    } else if (diff.inDays < 7) {
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return weekdays[dt.weekday % 7];
    } else {
      return '${dt.month}/${dt.day}';
    }
  }
}

/// Banner widget for "scroll to latest messages" - appears when user is viewing history
class _ScrollToLatestBanner extends StatelessWidget {
  final String text;
  final VoidCallback onTap;

  const _ScrollToLatestBanner({
    required this.text,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: EdgeInsets.symmetric(
          horizontal: UIKit.spaceMd(context),
          vertical: UIKit.spaceXs(context),
        ),
        padding: EdgeInsets.symmetric(
          horizontal: UIKit.spaceMd(context),
          vertical: UIKit.spaceXs(context),
        ),
        decoration: BoxDecoration(
          color: theme.colorScheme.primaryContainer,
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.1),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.arrow_downward,
              size: 16,
              color: theme.colorScheme.onPrimaryContainer,
            ),
            const SizedBox(width: 6),
            Text(
              text,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onPrimaryContainer,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
