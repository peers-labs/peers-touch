import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/ai_input_box.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_composer_draft.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/capability/capability_resolver.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/model_capability.dart';

class ChatInputBar extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onSend;
  final bool isSending;
  // 注入模型选择
  final List<String> models;
  final String currentModel;
  final ValueChanged<String> onModelChanged;
  // Provider 分组（按提供商显示模型分组）
  final Map<String, List<String>>? groupedModelsByProvider;

  const ChatInputBar({
    super.key,
    required this.controller,
    required this.onChanged,
    required this.onSend,
    required this.isSending,
    required this.models,
    required this.currentModel,
    required this.onModelChanged,
    this.groupedModelsByProvider,
  });

  @override
  Widget build(BuildContext context) {
    // 优先从 ProviderController 中读取已注入的能力
    ModelCapability? cap;
    if (Get.isRegistered<ProviderController>()) {
      final pc = Get.find<ProviderController>();
      final cp = pc.currentProvider.value;
      if (cp != null) {
        final settings = cp.settingsJson.isNotEmpty
            ? (jsonDecode(cp.settingsJson) as Map<String, dynamic>)
            : {};
        if (settings.containsKey('modelCapabilities')) {
          final capabilities = settings['modelCapabilities'] as Map<String, dynamic>?;
          if (capabilities != null && capabilities.containsKey(currentModel)) {
            final map = capabilities[currentModel] as Map<String, dynamic>;
            cap = ModelCapability(
              supportsText: map['supportsText'] ?? true,
              supportsImageInput: map['supportsImageInput'] ?? false,
              supportsFileInput: map['supportsFileInput'] ?? false,
              supportsAudioInput: map['supportsAudioInput'] ?? false,
              supportsStreaming: map['supportsStreaming'] ?? true,
              maxImages: map['maxImages'] ?? 4,
              maxFiles: map['maxFiles'] ?? 4,
              maxAudio: map['maxAudio'] ?? 1,
            );
          }
        }
        // 如果未找到注入的能力，尝试实时解析
        if (cap == null) {
          cap = CapabilityResolver.resolve(provider: cp.sourceType, modelId: currentModel);
        }
      }
    }

    // 回退逻辑
    if (cap == null) {
      final storage = Get.find<LocalStorage>();
      final provider = storage.get<String>(AIConstants.providerType) ?? 'OpenAI';
      cap = CapabilityResolver.resolve(provider: provider, modelId: currentModel);
    }

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
        models: models,
        currentModel: currentModel,
        onModelChanged: onModelChanged,
        groupedModelsByProvider: groupedModelsByProvider,
      ),
    );
  }
}