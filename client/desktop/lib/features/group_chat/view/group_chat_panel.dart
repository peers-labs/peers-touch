import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/chat_input_bar.dart';
import 'package:peers_touch_desktop/features/group_chat/controller/group_chat_controller.dart';
import 'package:peers_touch_desktop/features/group_chat/widgets/group_message_bubble.dart';

/// Panel displaying group chat messages and input
class GroupChatPanel extends StatelessWidget {
  const GroupChatPanel({super.key});

  @override
  Widget build(BuildContext context) {
    // Ensure controller exists (may already be created by GroupListPanel)
    final controller = Get.put(GroupChatController());

    return Container(
      color: UIKit.chatAreaBg(context),
      child: Column(
        children: [
          _buildHeader(context, controller),
          Divider(
            height: 1,
            thickness: UIKit.dividerThickness,
            color: UIKit.dividerColor(context),
          ),
          Expanded(
            child: Obx(() => _buildMessageList(context, controller)),
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
          _buildInputBar(context, controller),
        ],
      ),
    );
  }

  Widget _buildHeader(BuildContext context, GroupChatController controller) {
    final theme = Theme.of(context);

    return Container(
      height: UIKit.topBarHeight,
      padding: EdgeInsets.symmetric(horizontal: UIKit.spaceMd(context)),
      child: Row(
        children: [
          Obx(() {
            final group = controller.currentGroup.value;
            if (group == null) {
              return Expanded(
                child: Text(
                  '选择群组',
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: UIKit.textSecondary(context),
                  ),
                ),
              );
            }
            return Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    group.name,
                    style: theme.textTheme.titleMedium?.copyWith(
                      color: UIKit.textPrimary(context),
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  SizedBox(height: UIKit.spaceXs(context) / 2),
                  Text(
                    '${group.memberCount} 人',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: UIKit.textSecondary(context),
                    ),
                  ),
                ],
              ),
            );
          }),
          IconButton(
            icon: Icon(
              Icons.info_outline,
              color: UIKit.textSecondary(context),
            ),
            tooltip: '群组信息',
            onPressed: () {
              // TODO: Show group info dialog
            },
          ),
          IconButton(
            icon: Icon(
              Icons.more_vert,
              color: UIKit.textSecondary(context),
            ),
            tooltip: '更多',
            onPressed: () {
              // TODO: Show group menu
            },
          ),
        ],
      ),
    );
  }

  Widget _buildMessageList(BuildContext context, GroupChatController controller) {
    final group = controller.currentGroup.value;
    if (group == null) {
      return _buildEmptyState(
        context,
        icon: Icons.chat_bubble_outline,
        title: '选择群组开始聊天',
        subtitle: '从左侧列表选择一个群组',
      );
    }

    final messageList = controller.messages.toList();
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

    if (messageList.isEmpty) {
      return _buildEmptyState(
        context,
        icon: Icons.forum_outlined,
        title: '暂无消息',
        subtitle: '发送第一条消息开始对话',
      );
    }

    return ListView.builder(
      padding: EdgeInsets.all(UIKit.spaceMd(context)),
      itemCount: messageList.length,
      itemBuilder: (context, index) {
        final message = messageList[index];
        final isMe = message.senderDid == controller.currentUserId;
        return GroupMessageBubble(
          message: message,
          isMe: isMe,
          senderName: isMe ? controller.currentUserName : _getSenderName(message.senderDid),
          senderActorId: message.senderDid,
        );
      },
    );
  }

  Widget _buildEmptyState(
    BuildContext context, {
    required IconData icon,
    required String title,
    String? subtitle,
  }) {
    return Center(
      child: Padding(
        padding: EdgeInsets.all(UIKit.spaceXl(context)),
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
                icon,
                size: 32,
                color: UIKit.textSecondary(context),
              ),
            ),
            SizedBox(height: UIKit.spaceLg(context)),
            Text(
              title,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: UIKit.textPrimary(context),
                  ),
            ),
            if (subtitle != null) ...[
              SizedBox(height: UIKit.spaceXs(context)),
              Text(
                subtitle,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: UIKit.textSecondary(context),
                    ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildInputBar(BuildContext context, GroupChatController controller) {
    return Obx(() {
      final group = controller.currentGroup.value;
      if (group == null) {
        return const SizedBox.shrink();
      }

      return FriendChatInputBar(
        controller: controller.inputController,
        onSend: () {
          final text = controller.inputController.text;
          controller.sendMessage(text);
        },
        isSending: controller.isSending.value,
      );
    });
  }

  String _getSenderName(String senderDid) {
    // TODO: Get sender name from member list cache
    // For now, show a shortened version of DID
    if (senderDid.length > 10) {
      return '${senderDid.substring(0, 4)}...${senderDid.substring(senderDid.length - 4)}';
    }
    return senderDid;
  }
}
