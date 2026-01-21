import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

class FriendChatInputBar extends StatelessWidget {
  const FriendChatInputBar({
    super.key,
    required this.controller,
    required this.onSend,
    this.isSending = false,
    this.onAttachmentTap,
    this.onEmojiTap,
  });

  final TextEditingController controller;
  final VoidCallback onSend;
  final bool isSending;
  final VoidCallback? onAttachmentTap;
  final VoidCallback? onEmojiTap;

  @override
  Widget build(BuildContext context) {
    return Container(
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
              onPressed: onAttachmentTap,
              color: UIKit.textSecondary(context),
            ),
            IconButton(
              icon: const Icon(Icons.emoji_emotions_outlined),
              onPressed: onEmojiTap,
              color: UIKit.textSecondary(context),
            ),
            SizedBox(width: UIKit.spaceSm(context)),
            Expanded(
              child: _InputField(
                controller: controller,
                onSend: onSend,
                isSending: isSending,
              ),
            ),
            SizedBox(width: UIKit.spaceSm(context)),
            _SendButton(
              onSend: onSend,
              isSending: isSending,
              hasText: controller.text.isNotEmpty,
            ),
          ],
        ),
      ),
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

  @override
  Widget build(BuildContext context) {
    return KeyboardListener(
      focusNode: FocusNode(),
      onKeyEvent: (event) {
        if (event is KeyDownEvent &&
            event.logicalKey == LogicalKeyboardKey.enter &&
            !HardwareKeyboard.instance.isShiftPressed) {
          if (!isSending && controller.text.trim().isNotEmpty) {
            onSend();
          }
        }
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
