import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/ai_input_box.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_composer_draft.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/capability/capability_resolver.dart';

class ChatInputBar extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onSend;
  final bool isSending;
  const ChatInputBar({
    super.key,
    required this.controller,
    required this.onChanged,
    required this.onSend,
    required this.isSending,
  });

  @override
  Widget build(BuildContext context) {
    final storage = Get.find<LocalStorage>();
    final provider = storage.get<String>(AIConstants.providerType) ?? 'OpenAI';
    final model = Get.find<AIChatController>().currentModel.value;
    final cap = CapabilityResolver.resolve(provider: provider, modelId: model);

    return Padding(
      padding: EdgeInsets.all(UIKit.spaceMd(context)),
      child: AIInputBox(
        capability: cap,
        isSending: isSending,
        onSendDraft: (AiComposerDraft draft) {
          // 保持旧的 onSend 行为以兼容：同时调用 controller 的富内容发送
          Get.find<AIChatController>().sendDraft(draft);
        },
        onTextChanged: onChanged,
        externalTextController: controller,
      ),
    );
  }
}