import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class ChatInput extends StatefulWidget {
  final TextEditingController? controller;
  final ValueChanged<String>? onSubmitted;
  final VoidCallback? onAttach;
  final VoidCallback? onEmoji;
  final VoidCallback? onVoice;
  final String? hintText;
  final bool showAttachButton;
  final bool showEmojiButton;
  final bool showVoiceButton;
  final bool enabled;

  const ChatInput({
    super.key,
    this.controller,
    this.onSubmitted,
    this.onAttach,
    this.onEmoji,
    this.onVoice,
    this.hintText,
    this.showAttachButton = true,
    this.showEmojiButton = true,
    this.showVoiceButton = true,
    this.enabled = true,
  });

  @override
  State<ChatInput> createState() => _ChatInputState();
}

class _ChatInputState extends State<ChatInput> {
  late TextEditingController _controller;
  bool _hasText = false;

  @override
  void initState() {
    super.initState();
    _controller = widget.controller ?? TextEditingController();
    _controller.addListener(_onTextChanged);
  }

  @override
  void dispose() {
    _controller.removeListener(_onTextChanged);
    if (widget.controller == null) {
      _controller.dispose();
    }
    super.dispose();
  }

  void _onTextChanged() {
    setState(() {
      _hasText = _controller.text.isNotEmpty;
    });
  }

  void _handleSend() {
    if (_hasText && widget.onSubmitted != null) {
      widget.onSubmitted!(_controller.text);
      _controller.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: AppSpacing.sm,
        right: AppSpacing.sm,
        top: AppSpacing.xs,
        bottom: MediaQuery.of(context).padding.bottom + AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: AppColors.background,
        border: Border(
          top: BorderSide(
            color: AppColors.border,
            width: 0.5,
          ),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (widget.showAttachButton) ...[
            IconButton(
              icon: Icon(
                Icons.attach_file,
                size: 24,
                color: AppColors.textSecondary,
              ),
              onPressed: widget.enabled ? widget.onAttach : null,
            ),
          ],
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.sm,
                vertical: AppSpacing.xs,
              ),
              decoration: BoxDecoration(
                color: AppColors.backgroundSecondary,
                borderRadius: AppRadius.xlBorder,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      enabled: widget.enabled,
                      maxLines: 5,
                      minLines: 1,
                      decoration: InputDecoration(
                        hintText: widget.hintText ?? 'Type a message...',
                        hintStyle: TextStyle(
                          fontFamily: AppTypography.fontFamily,
                          fontSize: AppTypography.fontSizeMd,
                          color: AppColors.textTertiary,
                        ),
                        border: InputBorder.none,
                        contentPadding: EdgeInsets.zero,
                        isDense: true,
                      ),
                      style: TextStyle(
                        fontFamily: AppTypography.fontFamily,
                        fontSize: AppTypography.fontSizeMd,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                  if (widget.showEmojiButton) ...[
                    IconButton(
                      icon: Icon(
                        Icons.emoji_emotions_outlined,
                        size: 24,
                        color: AppColors.textSecondary,
                      ),
                      onPressed: widget.enabled ? widget.onEmoji : null,
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.xs),
          if (_hasText)
            GestureDetector(
              onTap: widget.enabled ? _handleSend : null,
              child: Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.primary,
                  borderRadius: AppRadius.fullBorder,
                ),
                child: const Icon(
                  Icons.send,
                  size: 20,
                  color: AppColors.white,
                ),
              ),
            )
          else if (widget.showVoiceButton)
            IconButton(
              icon: Icon(
                Icons.mic,
                size: 24,
                color: AppColors.textSecondary,
              ),
              onPressed: widget.enabled ? widget.onVoice : null,
            ),
        ],
      ),
    );
  }
}
