import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/network/rtc/rtc_signaling.dart';

import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/assistant_sidebar.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/header_toolbar.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/message_list_view.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/chat_input_bar.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/topic_panel.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/shell/widgets/three_pane_scaffold.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';

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
              Padding(
                padding: EdgeInsets.symmetric(horizontal: UIKit.spaceMd(ctx)),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: () => _showRegisterDialog(ctx),
                      child: const Text('注册网络'),
                    ),
                  ],
                ),
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
                    pc.providers.map((p) {
                      // 从settingsJson中解析模型列表
                      final settings = p.settingsJson.isNotEmpty 
                          ? jsonDecode(p.settingsJson) as Map<String, dynamic>
                          : {};
                      final providerModels = (settings['models'] as List<dynamic>? ?? [])
                          .whereType<String>()
                          .toList();
                      return MapEntry(p.name, providerModels);
                    }),
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

  void _showRegisterDialog(BuildContext ctx) {
    final urlController = TextEditingController(text: 'http://127.0.0.1:8080');
    final idController = TextEditingController();
    final roleController = TextEditingController(text: 'desktop');
    final addrsController = TextEditingController();
    showDialog<void>(
      context: ctx,
      builder: (dctx) => AlertDialog(
        title: const Text('注册网络'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: urlController, decoration: const InputDecoration(labelText: '信令URL')),
            TextField(controller: idController, decoration: const InputDecoration(labelText: '自身PeerId')),
            TextField(controller: roleController, decoration: const InputDecoration(labelText: '角色(mobile/desktop)')),
            TextField(controller: addrsController, decoration: const InputDecoration(labelText: 'Addrs(逗号分隔)')),
          ],
        ),
        actions: [
          TextButton(onPressed: ()=>Navigator.of(dctx).pop(), child: const Text('取消')),
          TextButton(onPressed: () async {
            final svc = RTCSignalingService(urlController.text.trim());
            await svc.registerPeer(
              idController.text.trim(),
              roleController.text.trim(),
              addrsController.text.split(',').where((e)=>e.trim().isNotEmpty).toList(),
            );
            Navigator.of(dctx).pop();
            ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('已注册到信令服务')));
          }, child: const Text('注册')),
        ],
      ),
    );
  }
}
