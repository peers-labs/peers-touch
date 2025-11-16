import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/attachment_tray.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/controller/ai_input_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/model_capability.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/input_box/models/ai_composer_draft.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';

typedef SendDraftCallback = void Function(AiComposerDraft draft);

/// LobeChat 风格的专业多模态输入框（按钮按模型能力动态启用）
class AIInputBox extends StatelessWidget {
  final ModelCapability capability;
  final bool isSending;
  final SendDraftCallback onSendDraft;
  final ValueChanged<String>? onTextChanged;
  final TextEditingController? externalTextController;
  // 注入的模型选择（ai_input 不读取配置）
  final List<String>? models;
  final String? currentModel;
  final ValueChanged<String>? onModelChanged;
  // 按 Provider 分组的模型选择（可选）
  final Map<String, List<String>>? groupedModelsByProvider;

  AIInputBox({
    super.key,
    required this.capability,
    required this.isSending,
    required this.onSendDraft,
    this.onTextChanged,
    this.externalTextController,
    this.models,
    this.currentModel,
    this.onModelChanged,
    this.groupedModelsByProvider,
  });

  @override
  Widget build(BuildContext context) {
    final ctrl = Get.put(AiInputController(), tag: 'ai-input-box');
    ctrl.configure(capability);

    final borderColor = Theme.of(context).dividerColor;
    final radius = BorderRadius.circular(12);

    // 一体化输入框：内部包含文本输入、工具栏与发送按钮
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: borderColor),
        borderRadius: radius,
        color: Theme.of(context).colorScheme.surface,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 文本输入区域（无边框）
          Obx(() {
            final tc = externalTextController ?? ctrl.textController;
            final hint = ctrl.sendMode.value == 'enter'
                ? '按 Enter 发送，按 Ctrl+Enter 换行'
                : '按 Ctrl+Enter 发送，按 Enter 换行';
            return Focus(
              canRequestFocus: false,
              onKeyEvent: (node, event) {
                if (event is! KeyDownEvent) return KeyEventResult.ignored;
                // 只在文本框处于焦点时响应
                if (!ctrl.textFocusNode.hasFocus) return KeyEventResult.ignored;
                final isEnter = event.logicalKey == LogicalKeyboardKey.enter;
                if (!isEnter) return KeyEventResult.ignored;
                final pressed = RawKeyboard.instance.keysPressed;
                final isCtrl = pressed.contains(LogicalKeyboardKey.controlLeft) ||
                    pressed.contains(LogicalKeyboardKey.controlRight);
                final mode = ctrl.sendMode.value;
                final shouldSend = (mode == 'enter' && !isCtrl) || (mode == 'ctrlEnter' && isCtrl);
                if (!shouldSend) return KeyEventResult.ignored;
                _triggerSend(context, ctrl);
                if (mode == 'enter') {
                  // 移除因回车产生的换行（若发生）
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    final sel = tc.selection;
                    final text = tc.text;
                    if (sel.start > 0 && sel.start <= text.length) {
                      final int i = sel.start;
                      if (text[i - 1] == '\n') {
                        final newText = text.replaceRange(i - 1, i, '');
                        tc.text = newText;
                        tc.selection = TextSelection.collapsed(offset: i - 1);
                      }
                    }
                  });
                }
                return KeyEventResult.handled;
              },
              child: TextField(
                controller: tc,
                focusNode: ctrl.textFocusNode,
                minLines: 2,
                maxLines: 8,
                onChanged: onTextChanged,
                decoration: InputDecoration(
                  border: InputBorder.none,
                  isDense: true,
                  hintText: hint,
                  contentPadding: EdgeInsets.zero,
                ),
              ),
            );
          }),
          const SizedBox(height: 6),
          // 工具栏与发送按钮（位于同一边框内）
          Row(
            children: [
              // 模型选择按钮（改为下拉面板，不弹窗）
              _providerMenuButton(context),
              const SizedBox(width: 8),
              _toolbar(context, ctrl),
              // 保存为主题按钮（位于右侧发送按钮前）
              const SizedBox(width: 4),
              Tooltip(
                message: AppLocalizations.of(context).saveAsTopic,
                child: IconButton(
                  icon: const Icon(Icons.save_outlined),
                  onPressed: () {
                    try {
                      final c = Get.find<AIChatController>();
                      final status = c.saveCurrentChatAsTopic();
                      final text = status == SaveTopicStatus.createdNew
                          ? AppLocalizations.of(context).topicSaved
                          : AppLocalizations.of(context).topicAlreadySaved;
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(text)),
                      );
                    } catch (_) {}
                  },
                ),
              ),
              const Spacer(),
              _sendCompositeButton(context, ctrl),
            ],
          ),
          // 附件托盘置于内部底部
          const SizedBox(height: 6),
          AttachmentTray(controller: ctrl),
        ],
      ),
    );
  }

  // 模型选择下拉面板按钮
  Widget _providerMenuButton(BuildContext context) {
    final theme = Theme.of(context);
    final menuController = MenuController();
    return MenuAnchor(
      controller: menuController,
      // 在图标上方 4 像素处展开
      alignmentOffset: const Offset(0, -4),
      menuChildren: [
        _buildProviderMenuContent(context),
      ],
      child: IconButton(
        tooltip: '选择模型',
        icon: Icon(Icons.public, color: theme.colorScheme.primary),
        onPressed: () => menuController.open(),
      ),
    );
  }

  // 圆形内嵌发送按钮（靠右）
  Widget _sendButtonInline(BuildContext context, AiInputController ctrl) {
    final tc = externalTextController ?? ctrl.textController;
    return Obx(() {
      // 附件变化触发重建
      final hasAttachments = ctrl.attachments.isNotEmpty;
      // 文本变化使用 ValueListenableBuilder 跟随 TextEditingController
      return ValueListenableBuilder<TextEditingValue>(
        valueListenable: tc,
        builder: (context, value, _) {
          final hasText = value.text.trim().isNotEmpty;
          final disabled = isSending || (!hasText && !hasAttachments);
          return SizedBox(
            width: 40,
            height: 40,
            child: FilledButton(
              style: ButtonStyle(
                shape: WidgetStateProperty.all(const CircleBorder()),
                padding: WidgetStateProperty.all(EdgeInsets.zero),
              ),
              onPressed: disabled
                  ? null
                  : () {
                      final draft = AiComposerDraft(
                        text: tc.text.trim(),
                        attachments: ctrl.attachments.toList(),
                        sendMode: ctrl.sendMode.value,
                      );
                      onSendDraft(draft);
                    },
              child: isSending
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.arrow_upward_rounded),
            ),
          );
        },
      );
    });
  }

  Widget _toolbar(BuildContext context, AiInputController ctrl) {
    final color = Theme.of(context).colorScheme.onSurfaceVariant;
    return Obx(() {
      // Explicitly read observables so Obx has reactive dependencies
      final _attachmentsLen = ctrl.attachments.length;
      final _sendMode = ctrl.sendMode.value;
      // Use computed flags based on current state
      final canImg = capability.supportsImageInput && ctrl.canAttachImage;
      final canFile = capability.supportsFileInput && ctrl.canAttachFile;
      final canAudio = capability.supportsAudioInput && ctrl.canAttachAudio;

      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: capability.supportsImageInput ? '添加图片' : '当前模型不支持图片输入',
            onPressed: canImg
                ? () {
                    // 这里先放一个占位：添加一个 1x1 像素占位图片，避免引入文件选择依赖。
                    ctrl.addImage(Uint8List.fromList([0]));
                  }
                : null,
            icon: Icon(Icons.image_outlined, color: color),
          ),
          IconButton(
            tooltip: capability.supportsFileInput ? '添加文件' : '当前模型不支持文件输入',
            onPressed: canFile
                ? () {
                    ctrl.addFile(Uint8List.fromList([0, 1, 2]), mime: 'text/plain', name: 'dummy.txt');
                  }
                : null,
            icon: Icon(Icons.attach_file, color: color),
          ),
          IconButton(
            tooltip: capability.supportsAudioInput ? '录音' : '当前模型不支持音频输入',
            onPressed: canAudio
                ? () {
                    ctrl.addAudio(Uint8List.fromList([0, 1]));
                  }
                : null,
            icon: Icon(Icons.mic_none, color: color),
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

  // 右侧与发送按钮并排的发送设置菜单
  Widget _sendSettingsButton(BuildContext context, AiInputController ctrl) {
    final color = Theme.of(context).colorScheme.onSurfaceVariant;
    return PopupMenuButton<String>(
      tooltip: '发送设置',
      itemBuilder: (context) => const [
        PopupMenuItem(value: 'enter', child: Text('按 Enter 发送')),
        PopupMenuItem(value: 'ctrlEnter', child: Text('按 Ctrl+Enter 发送')),
      ],
      onSelected: ctrl.setSendMode,
      icon: Icon(Icons.keyboard_alt_outlined, color: color),
    );
  }

  // 连体按钮：左侧发送设置 + 右侧发送
  Widget _sendCompositeButton(BuildContext context, AiInputController ctrl) {
    final theme = Theme.of(context);
    final tc = externalTextController ?? ctrl.textController;
    return Obx(() {
      final hasAttachments = ctrl.attachments.isNotEmpty;
      return ValueListenableBuilder<TextEditingValue>(
        valueListenable: tc,
        builder: (context, value, _) {
          final hasText = value.text.trim().isNotEmpty;
          final disabled = isSending || (!hasText && !hasAttachments);
          final borderColor = theme.dividerColor;
          final bg = theme.colorScheme.surface;
          final iconColor = disabled ? theme.disabledColor : theme.colorScheme.onSurfaceVariant;
          return Container(
            height: 36,
            width: 96,
            decoration: BoxDecoration(
              color: bg,
              border: Border.all(color: borderColor),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              children: [
                Expanded(
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTapDown: (d) => _showSendSettingsMenuAt(context, d.globalPosition, ctrl),
                    child: Center(
                      child: Icon(Icons.keyboard_alt_outlined, color: iconColor),
                    ),
                  ),
                ),
                Container(width: 1, height: double.infinity, color: borderColor),
                Expanded(
                  child: InkWell(
                    onTap: disabled ? null : () => _triggerSend(context, ctrl),
                    child: Center(
                      child: isSending
                          ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : Icon(Icons.send, color: disabled ? theme.disabledColor : theme.colorScheme.primary),
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      );
    });
  }

  void _showSendSettingsMenuAt(BuildContext context, Offset globalPos, AiInputController ctrl) {
    final overlay = Overlay.of(context).context.findRenderObject() as RenderBox;
    final position = RelativeRect.fromLTRB(
      globalPos.dx,
      globalPos.dy,
      overlay.size.width - globalPos.dx,
      overlay.size.height - globalPos.dy,
    );
    showMenu<String>(
      context: context,
      position: position,
      items: const [
        PopupMenuItem(value: 'enter', child: Text('按 Enter 发送')),
        PopupMenuItem(value: 'ctrlEnter', child: Text('按 Ctrl+Enter 发送')),
      ],
    ).then((v) {
      if (v != null) ctrl.setSendMode(v);
    });
  }

  void _triggerSend(BuildContext context, AiInputController ctrl) {
    final tc = externalTextController ?? ctrl.textController;
    final hasAttachments = ctrl.attachments.isNotEmpty;
    final hasText = tc.text.trim().isNotEmpty;
    if (!hasText && !hasAttachments) return;
    final draft = AiComposerDraft(
      text: tc.text.trim(),
      attachments: ctrl.attachments.toList(),
      sendMode: ctrl.sendMode.value,
    );
    onSendDraft(draft);
  }

  // 下拉面板显示 Provider/Model 选择（锚定在按钮处）
  Future<void> _showProviderModelMenuAt(BuildContext context, Offset globalPos) async {
    final ThemeData theme = Theme.of(context);
    final textTheme = theme.textTheme;
    final grouped = groupedModelsByProvider ?? {};
    final List<_ProviderEntry> entries = grouped.entries
        .map((e) => _ProviderEntry(
              id: e.key,
              name: e.key,
              sourceType: e.key.toLowerCase(),
              logoUrl: null,
              models: e.value,
            ))
        .toList();

    final RenderBox overlay = Overlay.of(context).context.findRenderObject() as RenderBox;
    final RelativeRect position = RelativeRect.fromLTRB(
      globalPos.dx,
      globalPos.dy,
      overlay.size.width - globalPos.dx,
      overlay.size.height - globalPos.dy,
    );

    await showMenu<void>(
      context: context,
      // 将菜单整体上移 4 像素，避免覆盖图标
      position: RelativeRect.fromLTRB(
        position.left,
        position.top - 4,
        position.right,
        position.bottom,
      ),
      items: [
        PopupMenuItem<void>(
          enabled: false,
          padding: EdgeInsets.zero,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520, maxHeight: 460),
            child: Material(
              color: theme.colorScheme.surface,
              child: _buildProviderMenuScrollableTree(context, entries, textTheme, theme),
            ),
          ),
        ),
      ],
    );
  }

  // 构建菜单内容（无折叠，树状展示，可滚动）
  Widget _buildProviderMenuContent(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final textTheme = theme.textTheme;
    final grouped = groupedModelsByProvider ?? {};
    final List<_ProviderEntry> entries = grouped.entries
        .map((e) => _ProviderEntry(
              id: e.key,
              name: e.key,
              sourceType: e.key.toLowerCase(),
              logoUrl: null,
              models: e.value,
            ))
        .toList();
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 520, maxHeight: 460),
      child: Material(
        color: theme.colorScheme.surface,
        child: _buildProviderMenuScrollableTree(context, entries, textTheme, theme),
      ),
    );
  }

  Widget _buildProviderMenuScrollableTree(
    BuildContext context,
    List<_ProviderEntry> entries,
    TextTheme textTheme,
    ThemeData theme,
  ) {
    return SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final e in entries) ...[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  _providerLogo(context, e),
                  const SizedBox(width: 10),
                  Expanded(child: Text(e.name, style: textTheme.bodyMedium)),
                  Icon(Icons.settings_outlined, size: 18, color: theme.colorScheme.onSurfaceVariant),
                  const SizedBox(width: 8),
                  Icon(Icons.chevron_right, size: 18, color: theme.colorScheme.onSurfaceVariant),
                ],
              ),
            ),
            if (e.models.isEmpty)
              Padding(
                padding: const EdgeInsets.only(left: 54, right: 16, bottom: 12),
                child: Text(
                  'No enabled model. Please go to settings to enable.',
                  style: textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              )
            else ...[
              for (final m in e.models)
                InkWell(
                  onTap: () {
                    onModelChanged?.call(m);
                    // 使用 MenuAnchor 时不需要 pop；使用 showMenu 时会自动关闭。
                  },
                  child: Padding(
                    padding: const EdgeInsets.only(left: 54, right: 8, top: 6, bottom: 6),
                    child: Row(
                      children: [
                        Icon(
                          currentModel == m ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                          size: 18,
                          color: theme.colorScheme.primary,
                        ),
                        const SizedBox(width: 8),
                        Expanded(child: Text(m, style: textTheme.bodySmall)),
                      ],
                    ),
                  ),
                ),
            ],
            const Divider(height: 1),
          ],
        ],
      ),
    );
  }

  Widget _providerLogo(BuildContext context, _ProviderEntry e) {
    final url = e.logoUrl ?? _defaultLogoFor(e.sourceType);
    if (url == null || url.isEmpty) {
      return const CircleAvatar(child: Icon(Icons.apartment, size: 18));
    }
    return ClipOval(
      child: Image.network(url, width: 28, height: 28, errorBuilder: (ctx, _, __) {
        return const CircleAvatar(child: Icon(Icons.apartment, size: 18));
      }),
    );
  }

  String? _defaultLogoFor(String sourceType) {
    final s = sourceType.toLowerCase();
    switch (s) {
      case 'openai':
        return 'https://images.ctfassets.net/xz1dnu24egyd/5yWIUlJ8Y2gF3mnoZ9f8rV/5a8a8b6d4be2f5c42f1b8350c9b574f0/openai.png?w=64';
      case 'anthropic':
        return 'https://avatars.githubusercontent.com/u/106541891?s=64&v=4';
      case 'google':
        return 'https://www.google.com/images/branding/product/2x/google_g_64dp.png';
      case 'ollama':
        return 'https://avatars.githubusercontent.com/u/139070193?s=64&v=4';
      default:
        return null;
    }
  }

}

class _ProviderEntry {
  final String id;
  final String name;
  final String sourceType;
  final String? logoUrl;
  final List<String> models;

  _ProviderEntry({
    required this.id,
    required this.name,
    required this.sourceType,
    required this.logoUrl,
    required this.models,
  });
}