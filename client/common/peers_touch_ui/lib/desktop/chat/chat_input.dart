import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class ChatInput extends StatefulWidget {
  final TextEditingController? controller;
  final ValueChanged<String>? onSubmitted;
  final VoidCallback? onAttach;
  final VoidCallback? onEmoji;
  final VoidCallback? onSend;
  final String? hintText;
  final bool showAttachButton;
  final bool showEmojiButton;
  final bool enabled;
  final int maxLines;

  const ChatInput({
    super.key,
    this.controller,
    this.onSubmitted,
    this.onAttach,
    this.onEmoji,
    this.onSend,
    this.hintText,
    this.showAttachButton = true,
    this.showEmojiButton = true,
    this.enabled = true,
    this.maxLines = 5,
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
    if (_hasText) {
      if (widget.onSubmitted != null) {
        widget.onSubmitted!(_controller.text);
      } else if (widget.onSend != null) {
        widget.onSend!();
      }
      _controller.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
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
            _IconButton(
              icon: Icons.attach_file,
              onPressed: widget.enabled ? widget.onAttach : null,
            ),
            const SizedBox(width: AppSpacing.xs),
          ],
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.xs,
              ),
              decoration: BoxDecoration(
                color: AppColors.backgroundSecondary,
                borderRadius: AppRadius.lgBorder,
                border: Border.all(
                  color: AppColors.border,
                  width: 1,
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      enabled: widget.enabled,
                      maxLines: widget.maxLines,
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
                      onSubmitted: (_) => _handleSend(),
                    ),
                  ),
                  if (widget.showEmojiButton) ...[
                    const SizedBox(width: AppSpacing.xs),
                    _IconButton(
                      icon: Icons.emoji_emotions_outlined,
                      onPressed: widget.enabled ? widget.onEmoji : null,
                      size: 20,
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.xs),
          _IconButton(
            icon: Icons.send,
            onPressed: widget.enabled && _hasText ? _handleSend : null,
            backgroundColor: _hasText ? AppColors.primary : null,
            iconColor: _hasText ? AppColors.white : AppColors.textTertiary,
          ),
        ],
      ),
    );
  }
}

class _IconButton extends StatefulWidget {
  final IconData icon;
  final VoidCallback? onPressed;
  final double size;
  final Color? backgroundColor;
  final Color? iconColor;

  const _IconButton({
    required this.icon,
    this.onPressed,
    this.size = 22,
    this.backgroundColor,
    this.iconColor,
  });

  @override
  State<_IconButton> createState() => _IconButtonState();
}

class _IconButtonState extends State<_IconButton> {
  bool _isHovered = false;

  @override
  Widget build(BuildContext context) {
    final bgColor = widget.backgroundColor ?? (_isHovered ? AppColors.backgroundTertiary : Colors.transparent);
    final iconColor = widget.iconColor ?? AppColors.textSecondary;
    final isDisabled = widget.onPressed == null;

    return MouseRegion(
      onEnter: (_) => setState(() => _isHovered = true),
      onExit: (_) => setState(() => _isHovered = false),
      child: GestureDetector(
        onTap: isDisabled ? null : widget.onPressed,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: isDisabled ? Colors.transparent : bgColor,
            borderRadius: AppRadius.mdBorder,
          ),
          child: Icon(
            widget.icon,
            size: widget.size,
            color: isDisabled ? AppColors.textQuaternary : iconColor,
          ),
        ),
      ),
    );
  }
}
