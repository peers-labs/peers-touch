import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';

// MYQ: 不要有硬编码 这里有必要用 statefull吗
class FriendChatInputBar extends StatefulWidget {
  const FriendChatInputBar({
    super.key,
    required this.controller,
    required this.onSend,
    this.isSending = false,
    this.onAttachmentTap,
    this.onEmojiTap,
    this.replyMessage,
    this.onCancelReply,
    this.showEmojiPicker = false,
    this.onEmojiSelected,
    this.onToggleEmojiPicker,
    this.onAddCustomSticker,
    this.onFavoriteSticker,
  });

  final TextEditingController controller;
  final VoidCallback onSend;
  final bool isSending;
  final VoidCallback? onAttachmentTap;
  final VoidCallback? onEmojiTap;
  final ReplyMessage? replyMessage;
  final VoidCallback? onCancelReply;
  final bool showEmojiPicker;
  final void Function(String emoji)? onEmojiSelected;
  final VoidCallback? onToggleEmojiPicker;
  /// 添加自定义表情包回调（点击+号）
  final VoidCallback? onAddCustomSticker;
  /// 收藏表情回调
  final VoidCallback? onFavoriteSticker;

  @override
  State<FriendChatInputBar> createState() => _FriendChatInputBarState();
}

class _FriendChatInputBarState extends State<FriendChatInputBar> {

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // 回复预览
        if (widget.replyMessage != null)
          ReplyPreview(
            replyMessage: widget.replyMessage!,
            onClose: widget.onCancelReply ?? () {},
          ),

        // 输入栏
        Container(
          padding: EdgeInsets.all(UIKit.spaceMd(context)),
          decoration: BoxDecoration(
            color: UIKit.chatAreaBg(context),
            border: Border(
              top: BorderSide(
                color: UIKit.dividerColor(context),
                width: UIKit.dividerThickness,
              ),
            ),
          ),
          child: SafeArea(
            top: false,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                IconButton(
                  icon: const Icon(Icons.add_circle_outline),
                  onPressed: widget.onAttachmentTap,
                  color: UIKit.textSecondary(context),
                ),
                IconButton(
                  icon: Icon(
                    widget.showEmojiPicker 
                        ? Icons.keyboard 
                        : Icons.emoji_emotions_outlined,
                  ),
                  onPressed: widget.onToggleEmojiPicker ?? widget.onEmojiTap,
                  color: widget.showEmojiPicker 
                      ? Theme.of(context).colorScheme.primary
                      : UIKit.textSecondary(context),
                ),
                SizedBox(width: UIKit.spaceSm(context)),
                Expanded(
                  child: _InputField(
                    controller: widget.controller,
                    onSend: widget.onSend,
                    isSending: widget.isSending,
                  ),
                ),
                SizedBox(width: UIKit.spaceSm(context)),
                _SendButton(
                  onSend: widget.onSend,
                  isSending: widget.isSending,
                  hasText: widget.controller.text.isNotEmpty,
                ),
              ],
            ),
          ),
        ),

        // 表情选择器
        if (widget.showEmojiPicker)
          SimpleEmojiPicker(
            onEmojiSelected: (emoji) {
              widget.onEmojiSelected?.call(emoji);
              // 插入 emoji 到输入框
              final text = widget.controller.text;
              final selection = widget.controller.selection;
              final newText = text.replaceRange(
                selection.start,
                selection.end,
                emoji,
              );
              widget.controller.text = newText;
              widget.controller.selection = TextSelection.collapsed(
                offset: selection.start + emoji.length,
              );
            },
            onBackspacePressed: () {
              final text = widget.controller.text;
              if (text.isNotEmpty) {
                widget.controller.text = text.substring(0, text.length - 1);
                widget.controller.selection = TextSelection.collapsed(
                  offset: widget.controller.text.length,
                );
              }
            },
            onAddCustomSticker: widget.onAddCustomSticker,
            onFavoriteSticker: widget.onFavoriteSticker,
          ),
      ],
    );
  }
}

class _InputField extends StatelessWidget {
  const _InputField({
    required this.controller,
    required this.onSend,
    required this.isSending,
  });

  final TextEditingController controller;
  final VoidCallback onSend;
  final bool isSending;

  /// 检查输入法是否正在输入（composing 状态）
  bool get _isComposing {
    final composing = controller.value.composing;
    return composing.isValid && !composing.isCollapsed;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      onKeyEvent: (node, event) {
        // 只处理按键按下事件
        if (event is! KeyDownEvent) {
          return KeyEventResult.ignored;
        }
        
        // Enter 键处理
        if (event.logicalKey == LogicalKeyboardKey.enter) {
          // 如果正在使用输入法输入，让输入法处理回车（上屏）
          if (_isComposing) {
            return KeyEventResult.ignored;
          }
          
          // Shift+Enter 换行
          if (HardwareKeyboard.instance.isShiftPressed) {
            return KeyEventResult.ignored;
          }
          
          // 普通回车发送消息
          if (!isSending && controller.text.trim().isNotEmpty) {
            onSend();
            return KeyEventResult.handled;
          }
        }
        
        return KeyEventResult.ignored;
      },
      child: TextField(
        controller: controller,
        maxLines: 5,
        minLines: 1,
        enabled: !isSending,
        textInputAction: TextInputAction.newline,
        decoration: InputDecoration(
          hintText: 'Type a message...',
          filled: true,
          fillColor: UIKit.inputFillLight(context),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
            borderSide: BorderSide.none,
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
            borderSide: BorderSide.none,
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
            borderSide: BorderSide(
              color: Theme.of(context).colorScheme.primary,
              width: UIKit.dividerThickness,
            ),
          ),
          contentPadding: EdgeInsets.symmetric(
            horizontal: UIKit.spaceMd(context),
            vertical: UIKit.spaceSm(context),
          ),
        ),
      ),
    );
  }
}

class _SendButton extends StatelessWidget {
  const _SendButton({
    required this.onSend,
    required this.isSending,
    required this.hasText,
  });

  final VoidCallback onSend;
  final bool isSending;
  final bool hasText;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      child: isSending
          ? SizedBox(
              width: UIKit.controlHeightMd,
              height: UIKit.controlHeightMd,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Theme.of(context).colorScheme.primary,
                ),
              ),
            )
          : IconButton(
              onPressed: onSend,
              icon: const Icon(Icons.send),
              style: IconButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.primary,
                foregroundColor: Theme.of(context).colorScheme.onPrimary,
                minimumSize: Size.square(UIKit.controlHeightMd),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
                ),
              ),
            ),
    );
  }
}
