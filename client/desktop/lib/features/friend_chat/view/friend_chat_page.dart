import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/friend_chat/controller/friend_chat_controller.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/chat_input_bar.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/chat_message_item.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/connection_debug_panel.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/session_list_item.dart';
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
          Container(
            height: UIKit.topBarHeight,
            padding: EdgeInsets.symmetric(horizontal: UIKit.spaceMd(context)),
            alignment: Alignment.center,
            child: SearchInput(
              hintText: 'Search chats...',
              fillColor: UIKit.inputFillLight(context),
              borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
            ),
          ),
          Divider(
            height: UIKit.spaceLg(context),
            thickness: UIKit.dividerThickness,
            color: UIKit.dividerColor(context),
          ),
          Expanded(
            child: Obx(() {
              final sessionList = controller.sessions.toList();
              final currentId = controller.currentSession.value?.id;
              return ListView.separated(
                itemCount: sessionList.length,
                separatorBuilder: (_, index) => Divider(
                  height: 1,
                  color: UIKit.dividerColor(context),
                ),
                itemBuilder: (context, index) {
                  final session = sessionList[index];
                  return SessionListItem(
                    session: session,
                    isSelected: session.id == currentId,
                    onTap: () => controller.selectSession(session),
                    onDelete: () => controller.deleteSession(session.id),
                  );
                },
              );
            }),
          ),
        ],
      ),
    );
  }

  Widget _buildChatPanel(BuildContext context) {
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
              return ListView.builder(
                padding: EdgeInsets.all(UIKit.spaceMd(context)),
                itemCount: messageList.length,
                itemBuilder: (context, index) {
                  final message = messageList[index];
                  final isMe = message.senderId == 'user1';
                  return ChatMessageItem(
                    message: message,
                    isMe: isMe,
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
                  if (session != null)
                    Text(
                      session.participantIds.length > 2
                          ? '${session.participantIds.length} members'
                          : 'Online',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: UIKit.textSecondary(context),
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
