import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/presentation/widgets/panels/assistant_sidebar.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/chat_session.dart';
import 'package:peers_touch_desktop/features/ai_chat/presentation/widgets/bars/header_toolbar.dart';
import 'package:peers_touch_desktop/features/ai_chat/presentation/widgets/messages/message_list_view.dart';
import 'package:peers_touch_desktop/features/ai_chat/presentation/widgets/inputs/chat_input_bar.dart';
import 'package:peers_touch_desktop/features/ai_chat/presentation/widgets/panels/topic_panel.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/shell/widgets/three_pane_scaffold.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:file_picker/file_picker.dart';
import 'dart:convert';

class AIChatPage extends GetView<AIChatController> {
  const AIChatPage({super.key});

  @override
  Widget build(BuildContext context) {
    return ShellThreePane(
      leftBuilder: (ctx) => Obx(() => AssistantSidebar(
            onNewChat: controller.newChat,
            sessions: controller.sessions.toList(),
            selectedId: controller.selectedSessionId.value,
            onSelectSession: controller.selectSession,
            onReorder: controller.reorderSessions,
            lastMessageGetter: controller.getLastMessagePreview,
            onRenameSession: (ChatSession s) async {
              final textController = TextEditingController(text: s.title);
              final newTitle = await showDialog<String>(
                context: ctx,
                builder: (dctx) => AlertDialog(
                  title: Text(AppLocalizations.of(dctx).renameSessionTitle),
                  content: TextField(
                    controller: textController,
                    decoration: InputDecoration(hintText: AppLocalizations.of(dctx).inputNewNamePlaceholder),
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.of(dctx).pop(null),
                      child: Text(AppLocalizations.of(dctx).cancel),
                    ),
                    TextButton(
                      onPressed: () => Navigator.of(dctx).pop(textController.text.trim()),
                      child: Text(AppLocalizations.of(dctx).confirm),
                    ),
                  ],
                ),
              );
              if (newTitle != null && newTitle.isNotEmpty) {
                controller.renameSession(s.id, newTitle);
              }
            },
            onDeleteSession: (ChatSession s) async {
              final ok = await showDialog<bool>(
                context: ctx,
                builder: (dctx) => AlertDialog(
                  title: Text(AppLocalizations.of(dctx).deleteSessionTitle),
                  content: Text(AppLocalizations.of(dctx).deleteSessionConfirm(s.title)),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.of(dctx).pop(false),
                      child: Text(AppLocalizations.of(dctx).cancel),
                    ),
                    TextButton(
                      onPressed: () => Navigator.of(dctx).pop(true),
                      child: Text(AppLocalizations.of(dctx).confirm),
                    ),
                  ],
                ),
              );
              if (ok == true) {
                controller.deleteSession(s.id);
              }
            },
            onChangeAvatar: (ChatSession s) async {
              // 选择图片并预览后确认
              final result = await FilePicker.platform.pickFiles(
                type: FileType.image,
                allowMultiple: false,
                withData: true,
              );
              if (result == null || result.files.isEmpty) return;
              final file = result.files.first;
              final bytes = file.bytes;
              if (bytes == null) return;
              final b64 = base64Encode(bytes);
              final ok = await showDialog<bool>(
                context: ctx,
                builder: (dctx) {
                  return AlertDialog(
                    title: Text('预览头像'),
                    content: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(56),
                          child: Image.memory(bytes, width: 112, height: 112, fit: BoxFit.cover),
                        ),
                        SizedBox(height: UIKit.spaceSm(dctx)),
                        Text(file.name, style: Theme.of(dctx).textTheme.bodySmall),
                      ],
                    ),
                    actions: [
                      TextButton(onPressed: () => Navigator.of(dctx).pop(false), child: Text(AppLocalizations.of(dctx).cancel)),
                      TextButton(onPressed: () => Navigator.of(dctx).pop(true), child: Text(AppLocalizations.of(dctx).confirm)),
                    ],
                  );
                },
              );
              if (ok == true) {
                controller.setSessionAvatar(s.id, b64);
              }
            },
          )),
      centerBuilder: (ctx) => Container(
        color: UIKit.chatAreaBg(ctx),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
              // 顶部工具栏（在闭包内直接读取 Rx 值，避免 GetX 误用提示）
              Obx(() {
                final sending = controller.isSending.value;
                // 计算标题为当前会话标题
                String headerTitle = AppLocalizations.of(ctx).chatDefaultTitle;
                final sid = controller.selectedSessionId.value;
                if (sid != null) {
                  final match = controller.sessions.where((e) => e.id == sid);
                  if (match.isNotEmpty) headerTitle = match.first.title;
                }
                // 确保右侧面板内容在首次进入时已注入（默认折叠）
                final shell = Get.find<ShellController>();
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (shell.rightPanelBuilder.value == null) {
                    shell.openRightPanelWithOptions(
                      (bctx) => Obx(() => TopicPanel(
                        topics: controller.topics.toList(),
                        onAddTopic: () => controller.addTopic(),
                        onDeleteTopic: controller.removeTopicAt,
                        onSelectTopic: controller.selectTopicAt,
                        onRenameTopic: (int index) async {
                          final old = controller.topics[index];
                          final textController = TextEditingController(text: old);
                          final newTitle = await showDialog<String>(
                            context: bctx,
                            builder: (dctx) => AlertDialog(
                              title: Text(AppLocalizations.of(dctx).renameTopicTitle),
                              content: TextField(
                                controller: textController,
                                decoration: InputDecoration(hintText: AppLocalizations.of(dctx).inputNewNamePlaceholder),
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.of(dctx).pop(null),
                                  child: Text(AppLocalizations.of(dctx).cancel),
                                ),
                                TextButton(
                                  onPressed: () => Navigator.of(dctx).pop(textController.text.trim()),
                                  child: Text(AppLocalizations.of(dctx).confirm),
                                ),
                              ],
                            ),
                          );
                          if (newTitle != null && newTitle.isNotEmpty) {
                            controller.renameTopic(index, newTitle);
                          }
                        },
                        // 闪动索引从控制器读取
                        flashIndex: controller.flashTopicIndex.value,
                      )),
                      width: UIKit.rightPanelWidth,
                      showCollapseButton: true,
                      clearCenter: false,
                      collapsedByDefault: true,
                    );
                  }
                });
                return AIChatHeaderBar(
                  title: headerTitle,
                  isSending: sending,
                  onNewChat: controller.newChat,
                );
              }),
              Divider(
                height: UIKit.spaceLg(ctx),
                thickness: UIKit.dividerThickness,
                color: UIKit.dividerColor(ctx),
              ),
              // 消息列表（在闭包内读取 RxList 内容）
              Flexible(
                flex: 1,
                child: Obx(() {
                  final msgs = controller.messages.toList();
                  return MessageListView(messages: msgs);
                }),
              ),
              // 错误提示
              Obx(() {
                final err = controller.error.value;
                if (err == null) return const SizedBox.shrink();
                return Padding(
                  padding: EdgeInsets.symmetric(
                      horizontal: UIKit.spaceMd(ctx),
                      vertical: UIKit.spaceXs(ctx)),
                  child: Text(
                    err,
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: UIKit.errorColor(ctx)),
                  ),
                );
              }),
              // 输入框
              Obx(() {
                // 读取响应式模型数据以触发重建
                final models = controller.models.toList();
                final current = controller.currentModel.value;
                // Provider 分组：读取 ProviderController 中的列表
                Map<String, List<String>> grouped = {};
                if (Get.isRegistered<ProviderController>()) {
                  final pc = Get.find<ProviderController>();
                  grouped = Map.fromEntries(
                    pc.providers.map((p) => MapEntry(p.name, p.models)),
                  );
                }
                return ChatInputBar(
                  controller: controller.inputController,
                  onChanged: controller.setInput,
                  onSend: controller.send,
                  isSending: controller.isSending.value,
                  models: models,
                  currentModel: current,
                  onModelChanged: controller.setModel,
                  groupedModelsByProvider: grouped,
                );
              }),
          ],
        ),
      ),
      leftProps: PaneProps(
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
}