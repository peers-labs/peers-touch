import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/attachment_tray.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/controller/ai_input_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/model_capability.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_composer_draft.dart';

typedef SendDraftCallback = void Function(AiComposerDraft draft);

/// LobeChat 风格的专业多模态输入框（按钮按模型能力动态启用）
class AIInputBox extends StatelessWidget {
  final ModelCapability capability;
  final bool isSending;
  final SendDraftCallback onSendDraft;
  final ValueChanged<String>? onTextChanged;
  final TextEditingController? externalTextController;

  const AIInputBox({
    super.key,
    required this.capability,
    required this.isSending,
    required this.onSendDraft,
    this.onTextChanged,
    this.externalTextController,
  });

  @override
  Widget build(BuildContext context) {
    final ctrl = Get.put(AiInputController(), tag: 'ai-input-box');
    ctrl.configure(capability);

    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: BorderSide(color: Theme.of(context).dividerColor),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AttachmentTray(controller: ctrl),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            _leadingProviderButton(context),
            Expanded(
              child: TextField(
                controller: externalTextController ?? ctrl.textController,
                focusNode: ctrl.textFocusNode,
                minLines: 1,
                maxLines: 8,
                onChanged: onTextChanged,
                decoration: InputDecoration(
                  hintText: '输入你的消息，Ctrl+Enter 换行',
                  isDense: true,
                  border: border,
                  enabledBorder: border,
                  focusedBorder: border.copyWith(
                    borderSide: BorderSide(color: Theme.of(context).colorScheme.primary),
                  ),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                ),
              ),
            ),
            const SizedBox(width: 8),
            _toolbar(context, ctrl),
            const SizedBox(width: 8),
            _sendButton(context, ctrl),
          ],
        ),
      ],
    );
  }

  Widget _leadingProviderButton(BuildContext context) {
    return Tooltip(
      message: '模型能力驱动工具可用性',
      child: Container(
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          border: Border.all(color: Theme.of(context).dividerColor),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(Icons.auto_awesome, color: Theme.of(context).colorScheme.primary),
      ),
    );
  }

  Widget _sendButton(BuildContext context, AiInputController ctrl) {
    final disabled = isSending || (!capability.supportsText && ctrl.attachments.isEmpty);
    return IconButton.filled(
      onPressed: disabled
          ? null
          : () {
              final draft = AiComposerDraft(
                text: ctrl.textController.text.trim(),
                attachments: ctrl.attachments.toList(),
                sendMode: ctrl.sendMode.value,
              );
              onSendDraft(draft);
            },
      icon: isSending ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_rounded),
      tooltip: '发送',
    );
  }

  Widget _toolbar(BuildContext context, AiInputController ctrl) {
    final color = Theme.of(context).colorScheme.onSurfaceVariant;
    return Obx(() {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: capability.supportsImageInput ? '添加图片' : '当前模型不支持图片输入',
            onPressed: capability.supportsImageInput && ctrl.canAttachImage
                ? () {
                    // 这里先放一个占位：添加一个 1x1 像素占位图片，避免引入文件选择依赖。
                    ctrl.addImage(Uint8List.fromList([0]));
                  }
                : null,
            icon: Icon(Icons.image_outlined, color: color),
          ),
          IconButton(
            tooltip: capability.supportsFileInput ? '添加文件' : '当前模型不支持文件输入',
            onPressed: capability.supportsFileInput && ctrl.canAttachFile
                ? () {
                    ctrl.addFile(Uint8List.fromList([0, 1, 2]), mime: 'text/plain', name: 'dummy.txt');
                  }
                : null,
            icon: Icon(Icons.attach_file, color: color),
          ),
          IconButton(
            tooltip: capability.supportsAudioInput ? '录音' : '当前模型不支持音频输入',
            onPressed: capability.supportsAudioInput && ctrl.canAttachAudio
                ? () {
                    ctrl.addAudio(Uint8List.fromList([0, 1]));
                  }
                : null,
            icon: Icon(Icons.mic_none, color: color),
          ),
          PopupMenuButton<String>(
            tooltip: '发送设置',
            itemBuilder: (context) => [
              const PopupMenuItem(value: 'enter', child: Text('按 Enter 发送')),
              const PopupMenuItem(value: 'ctrlEnter', child: Text('按 Ctrl+Enter 发送')),
            ],
            onSelected: ctrl.setSendMode,
            icon: Icon(Icons.keyboard_alt_outlined, color: color),
          ),
          IconButton(
            tooltip: '清空输入',
            onPressed: () => ctrl.clearAll(),
            icon: Icon(Icons.backspace, color: color),
          ),
        ],
      );
    });
  }
}