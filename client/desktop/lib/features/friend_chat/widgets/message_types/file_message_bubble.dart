import 'package:flutter/material.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_desktop/features/shared/extensions/chat_message_extensions.dart';
import 'package:peers_touch_desktop/features/friend_chat/models/upload_progress.dart';
import 'package:peers_touch_desktop/features/friend_chat/services/attachment_upload_service.dart';

class FileMessageBubble extends StatelessWidget {
  final ChatMessage message;
  final bool isMe;
  final VoidCallback? onRetry;

  const FileMessageBubble({
    super.key,
    required this.message,
    required this.isMe,
    this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final attachment = message.attachments?.first;
    if (attachment == null) {
      return const SizedBox.shrink();
    }

    return Container(
      constraints: const BoxConstraints(
        maxWidth: 300,
        minWidth: 200,
      ),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isMe
            ? Theme.of(context).colorScheme.primary.withOpacity(0.1)
            : Theme.of(context).colorScheme.surfaceVariant,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isMe
              ? Theme.of(context).colorScheme.primary.withOpacity(0.3)
              : Colors.grey.withOpacity(0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _buildFileIcon(context, attachment.type),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      attachment.name,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w500,
                          ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      attachment.displaySize,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Colors.grey[600],
                          ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (message.status == MessageStatus.MESSAGE_STATUS_SENDING &&
              message.uploadProgress != null)
            _buildUploadProgress(context, message.uploadProgress!),
          if (message.status == MessageStatus.MESSAGE_STATUS_FAILED)
            _buildFailedState(context),
          if (message.status == MessageStatus.MESSAGE_STATUS_SENT)
            _buildDownloadButton(context, attachment.url),
        ],
      ),
    );
  }

  Widget _buildFileIcon(BuildContext context, String typeName) {
    IconData icon;
    Color color;

    switch (typeName.toUpperCase()) {
      case 'IMAGE':
        icon = Icons.image;
        color = Colors.purple;
        break;
      case 'VIDEO':
        icon = Icons.videocam;
        color = Colors.red;
        break;
      case 'AUDIO':
        icon = Icons.audiotrack;
        color = Colors.orange;
        break;
      case 'FILE':
      default:
        icon = Icons.insert_drive_file;
        color = Colors.blue;
        break;
    }

    return Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Icon(
        icon,
        color: color,
        size: 28,
      ),
    );
  }

  Widget _buildUploadProgress(BuildContext context, UploadProgress progress) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          LinearProgressIndicator(
            value: progress.percentage,
            backgroundColor: Colors.grey[300],
            valueColor: AlwaysStoppedAnimation<Color>(
              Theme.of(context).colorScheme.primary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            '上传中 ${(progress.percentage * 100).toInt()}%',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Colors.grey[600],
                ),
          ),
        ],
      ),
    );
  }

  Widget _buildFailedState(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(
        children: [
          Icon(
            Icons.error_outline,
            size: 16,
            color: Colors.red[400],
          ),
          const SizedBox(width: 4),
          Text(
            '上传失败',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Colors.red[400],
                ),
          ),
          const Spacer(),
          TextButton(
            onPressed: onRetry,
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: const Size(0, 32),
            ),
            child: const Text('重试'),
          ),
        ],
      ),
    );
  }

  Widget _buildDownloadButton(BuildContext context, String fileUrl) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          onPressed: () {
            _handleDownload(context, fileUrl);
          },
          icon: const Icon(Icons.download, size: 18),
          label: const Text('下载'),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 8),
          ),
        ),
      ),
    );
  }

  String _formatFileSize(int bytes) {
    return AttachmentUploadService().formatFileSize(bytes);
  }

  void _handleDownload(BuildContext context, String fileUrl) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('开始下载: $fileUrl'),
        duration: const Duration(seconds: 2),
      ),
    );
  }
}
