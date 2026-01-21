import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_base/widgets/avatar.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

class ChatMessageItem extends StatelessWidget {
  const ChatMessageItem({
    super.key,
    required this.message,
    required this.isMe,
    required this.senderName,
    this.senderAvatarUrl,
    this.showAvatarOnRight = true,
  });

  final ChatMessage message;
  final bool isMe;
  final String senderName;
  final String? senderAvatarUrl;
  final bool showAvatarOnRight;

  @override
  Widget build(BuildContext context) {
    final showOnRight = isMe && showAvatarOnRight;
    
    return Padding(
      padding: EdgeInsets.symmetric(vertical: UIKit.spaceXs(context)),
      child: Row(
        mainAxisAlignment: showOnRight ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!showOnRight) ...[
            _buildAvatar(context),
            SizedBox(width: UIKit.spaceSm(context)),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment:
                  showOnRight ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                _buildMessageContent(context, showOnRight),
                SizedBox(height: UIKit.spaceXs(context)),
                _buildTimestamp(context, showOnRight),
              ],
            ),
          ),
          if (showOnRight) ...[
            SizedBox(width: UIKit.spaceSm(context)),
            _buildAvatar(context),
          ],
        ],
      ),
    );
  }

  Widget _buildAvatar(BuildContext context) {
    return Avatar(
      actorId: message.senderId,
      avatarUrl: senderAvatarUrl,
      fallbackName: senderName,
      size: 40,
    );
  }

  Widget _buildMessageContent(BuildContext context, bool showOnRight) {
    switch (message.type) {
      case MessageType.MESSAGE_TYPE_IMAGE:
        return _buildImageMessage(context, showOnRight);
      case MessageType.MESSAGE_TYPE_FILE:
        return _buildFileMessage(context, showOnRight);
      default:
        return _buildTextMessage(context, showOnRight);
    }
  }

  Widget _buildTextMessage(BuildContext context, bool showOnRight) {
    return Container(
      constraints: BoxConstraints(
        minWidth: 40,
        maxWidth: MediaQuery.of(context).size.width * 0.6,
      ),
      padding: EdgeInsets.symmetric(
        horizontal: UIKit.spaceMd(context),
        vertical: UIKit.spaceSm(context),
      ),
      decoration: BoxDecoration(
        color: isMe
            ? Theme.of(context).colorScheme.primaryContainer
            : Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
      ),
      child: SelectableText(
        message.content,
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: isMe
                  ? Theme.of(context).colorScheme.onPrimaryContainer
                  : Theme.of(context).colorScheme.onSurface,
            ),
      ),
    );
  }

  Widget _buildImageMessage(BuildContext context, bool showOnRight) {
    final imageUrl = message.metadata['imageUrl'] ?? message.content;
    
    return Container(
      constraints: BoxConstraints(
        maxWidth: MediaQuery.of(context).size.width * 0.4,
        maxHeight: 300,
      ),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
        border: Border.all(
          color: Theme.of(context).colorScheme.outline.withValues(alpha: 0.2),
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
        child: imageUrl.startsWith('http')
            ? Image.network(
                imageUrl,
                fit: BoxFit.cover,
                loadingBuilder: (context, child, loadingProgress) {
                  if (loadingProgress == null) return child;
                  return Container(
                    width: 200,
                    height: 150,
                    color: Theme.of(context).colorScheme.surfaceContainerHighest,
                    child: Center(
                      child: CircularProgressIndicator(
                        value: loadingProgress.expectedTotalBytes != null
                            ? loadingProgress.cumulativeBytesLoaded /
                                loadingProgress.expectedTotalBytes!
                            : null,
                      ),
                    ),
                  );
                },
                errorBuilder: (context, error, stackTrace) {
                  return Container(
                    width: 200,
                    height: 150,
                    color: Theme.of(context).colorScheme.errorContainer,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.broken_image,
                          color: Theme.of(context).colorScheme.onErrorContainer,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Failed to load',
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.onErrorContainer,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  );
                },
              )
            : Container(
                width: 200,
                height: 150,
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                child: const Icon(Icons.image, size: 48),
              ),
      ),
    );
  }

  Widget _buildFileMessage(BuildContext context, bool showOnRight) {
    final fileName = message.metadata['fileName'] ?? 'File';
    final fileSize = message.metadata['fileSize'] ?? '';
    
    return Container(
      constraints: BoxConstraints(
        maxWidth: MediaQuery.of(context).size.width * 0.5,
      ),
      padding: EdgeInsets.all(UIKit.spaceSm(context)),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
        border: Border.all(
          color: Theme.of(context).colorScheme.outline.withValues(alpha: 0.2),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(
              _getFileIcon(fileName),
              color: Theme.of(context).colorScheme.primary,
            ),
          ),
          SizedBox(width: UIKit.spaceSm(context)),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  fileName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                ),
                if (fileSize.isNotEmpty)
                  Text(
                    fileSize,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: UIKit.textSecondary(context),
                        ),
                  ),
              ],
            ),
          ),
          SizedBox(width: UIKit.spaceSm(context)),
          IconButton(
            icon: const Icon(Icons.download),
            iconSize: 20,
            onPressed: () {},
          ),
        ],
      ),
    );
  }

  IconData _getFileIcon(String fileName) {
    final ext = fileName.split('.').last.toLowerCase();
    switch (ext) {
      case 'pdf':
        return Icons.picture_as_pdf;
      case 'doc':
      case 'docx':
        return Icons.description;
      case 'xls':
      case 'xlsx':
        return Icons.table_chart;
      case 'ppt':
      case 'pptx':
        return Icons.slideshow;
      case 'zip':
      case 'rar':
      case '7z':
        return Icons.folder_zip;
      case 'mp3':
      case 'wav':
      case 'flac':
        return Icons.audio_file;
      case 'mp4':
      case 'avi':
      case 'mov':
        return Icons.video_file;
      default:
        return Icons.insert_drive_file;
    }
  }

  Widget _buildTimestamp(BuildContext context, bool showOnRight) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          _formatTime(message.sentAt.toDateTime()),
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: UIKit.textSecondary(context),
                fontSize: 10,
              ),
        ),
        if (isMe) ...[
          SizedBox(width: UIKit.spaceXs(context)),
          _buildStatusIcon(context),
        ],
      ],
    );
  }

  Widget _buildStatusIcon(BuildContext context) {
    IconData icon;
    Color color;

    switch (message.status) {
      case MessageStatus.MESSAGE_STATUS_SENDING:
        icon = Icons.access_time;
        color = UIKit.textSecondary(context);
      case MessageStatus.MESSAGE_STATUS_SENT:
        icon = Icons.check;
        color = UIKit.textSecondary(context);
      case MessageStatus.MESSAGE_STATUS_DELIVERED:
        icon = Icons.done_all;
        color = Theme.of(context).colorScheme.primary;
      case MessageStatus.MESSAGE_STATUS_FAILED:
        icon = Icons.error_outline;
        color = UIKit.errorColor(context);
      default:
        icon = Icons.check;
        color = UIKit.textSecondary(context);
    }

    return Icon(icon, size: 14, color: color);
  }

  String _formatTime(DateTime dt) {
    return DateFormat.Hm().format(dt);
  }
}
