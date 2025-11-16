import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

class MessageInput extends StatefulWidget {
  final TextEditingController controller;
  final Function(String) onSend;

  const MessageInput({
    super.key,
    required this.controller,
    required this.onSend,
  });

  @override
  State<MessageInput> createState() => _MessageInputState();
}

class _MessageInputState extends State<MessageInput> {
  bool _showEmojiPicker = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final bool hasText = widget.controller.text.isNotEmpty;
    
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(
          top: BorderSide(color: const Color(0xFFE5E5E5), width: 1),
        ),
      ),
      child: Row(
        children: [
          // Emoji button
          IconButton(
            icon: Icon(
              _showEmojiPicker ? Icons.keyboard : Icons.emoji_emotions,
              color: const Color(0xFF999999),
            ),
            onPressed: () {
              setState(() {
                _showEmojiPicker = !_showEmojiPicker;
              });
              // TODO: Implement emoji picker
              appLogger.info('Emoji picker toggled: $_showEmojiPicker');
            },
          ),
          
          // Attachment button
          IconButton(
            icon: const Icon(
              Icons.attach_file,
              color: Color(0xFF999999),
            ),
            onPressed: () {
              _showAttachmentOptions(context);
            },
          ),
          
          // Text input field
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFE5E5E5)),
              ),
              child: TextField(
                controller: widget.controller,
                decoration: InputDecoration(
                  hintText: l10n.typeMessage,
                  hintStyle: const TextStyle(color: Color(0xFF999999)),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  border: InputBorder.none,
                ),
                maxLines: 5,
                minLines: 1,
                textInputAction: TextInputAction.send,
                onSubmitted: (value) {
                  if (value.trim().isNotEmpty) {
                    widget.onSend(value);
                  }
                },
              ),
            ),
          ),
          
          // Send button
          const SizedBox(width: 8),
          TextButton(
            onPressed: hasText 
                ? () {
                    widget.onSend(widget.controller.text);
                  }
                : null,
            style: TextButton.styleFrom(
              backgroundColor: hasText ? const Color(0xFF07C160) : const Color(0xFFCCCCCC),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            child: Text(l10n.send),
          ),
        ],
      ),
    );
  }

  void _showAttachmentOptions(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(12)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _buildAttachmentOption(
                      icon: Icons.photo,
                      label: l10n.photo,
                      onTap: () {
                        Navigator.pop(context);
                        // TODO: Implement photo attachment
                        appLogger.info('Photo attachment selected');
                      },
                    ),
                    _buildAttachmentOption(
                      icon: Icons.file_present,
                      label: l10n.file,
                      onTap: () {
                        Navigator.pop(context);
                        // TODO: Implement file attachment
                        appLogger.info('File attachment selected');
                      },
                    ),
                    _buildAttachmentOption(
                      icon: Icons.location_on,
                      label: l10n.location,
                      onTap: () {
                        Navigator.pop(context);
                        // TODO: Implement location attachment
                        appLogger.info('Location attachment selected');
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _buildAttachmentOption(
                      icon: Icons.mic,
                      label: l10n.voice,
                      onTap: () {
                        Navigator.pop(context);
                        // TODO: Implement voice attachment
                        appLogger.info('Voice attachment selected');
                      },
                    ),
                    _buildAttachmentOption(
                      icon: Icons.videocam,
                      label: l10n.video,
                      onTap: () {
                        Navigator.pop(context);
                        // TODO: Implement video attachment
                        appLogger.info('Video attachment selected');
                      },
                    ),
                    _buildAttachmentOption(
                      icon: Icons.contact_page,
                      label: l10n.contact,
                      onTap: () {
                        Navigator.pop(context);
                        // TODO: Implement contact attachment
                        appLogger.info('Contact attachment selected');
                      },
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildAttachmentOption({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 60,
            height: 60,
            decoration: BoxDecoration(
              color: Colors.grey[200],
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 28, color: Colors.black87),
          ),
          const SizedBox(height: 8),
          Text(label, style: const TextStyle(fontSize: 12)),
        ],
      ),
    );
  }
}