import 'package:flutter/material.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_desktop/features/shared/extensions/chat_message_extensions.dart';
import 'package:peers_touch_desktop/features/friend_chat/models/upload_progress.dart';
import 'package:peers_touch_ui/components/media/image_viewer.dart';

class ImageMessageBubble extends StatelessWidget {
  final ChatMessage message;
  final bool isMe;

  const ImageMessageBubble({
    super.key,
    required this.message,
    required this.isMe,
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
        maxHeight: 400,
      ),
      child: Column(
        crossAxisAlignment:
            isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Stack(
              children: [
                if (message.status == MessageStatus.MESSAGE_STATUS_SENDING)
                  _buildUploadingState(context, attachment)
                else if (message.status == MessageStatus.MESSAGE_STATUS_FAILED)
                  _buildFailedState(context, attachment)
                else
                  _buildSuccessState(context, attachment),
                
                if (message.status == MessageStatus.MESSAGE_STATUS_SENDING &&
                    message.uploadProgress != null)
                  _buildProgressOverlay(context, message.uploadProgress!),
              ],
            ),
          ),
          
          if (message.content.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: isMe
                      ? Theme.of(context).colorScheme.primary
                      : Theme.of(context).colorScheme.surfaceVariant,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  message.content,
                  style: TextStyle(
                    color: isMe ? Colors.white : null,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildUploadingState(BuildContext context, attachment) {
    return Container(
      width: 300,
      height: 200,
      color: Colors.grey[300],
      child: const Center(
        child: CircularProgressIndicator(),
      ),
    );
  }

  Widget _buildFailedState(BuildContext context, attachment) {
    return Container(
      width: 300,
      height: 200,
      color: Colors.grey[300],
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.error_outline,
            size: 48,
            color: Colors.red[300],
          ),
          const SizedBox(height: 8),
          Text(
            '上传失败',
            style: TextStyle(
              color: Colors.red[300],
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () {},
            child: const Text('重试'),
          ),
        ],
      ),
    );
  }

  Widget _buildSuccessState(BuildContext context, attachment) {
    final imageUrl = attachment.thumbnailUrl ?? attachment.url;

    return GestureDetector(
      onTap: () {
        _showFullImage(context, attachment.url);
      },
      child: Hero(
        tag: 'image_${message.id}',
        child: PeersImage(
          src: imageUrl,
          width: 300,
          fit: BoxFit.cover,
          error: Container(
            width: 300,
            height: 200,
            color: Colors.grey[300],
            child: const Center(
              child: Icon(
                Icons.broken_image,
                size: 48,
                color: Colors.grey,
              ),
            ),
          ),
          placeholder: Container(
            width: 300,
            height: 200,
            color: Colors.grey[200],
            child: const Center(
              child: CircularProgressIndicator(),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildProgressOverlay(BuildContext context, UploadProgress progress) {
    return Positioned.fill(
      child: Container(
        color: Colors.black.withOpacity(0.5),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(
              value: progress.percentage,
              backgroundColor: Colors.white.withOpacity(0.3),
              valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
            ),
            const SizedBox(height: 8),
            Text(
              '${(progress.percentage * 100).toInt()}%',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showFullImage(BuildContext context, String imageUrl) {
    showDialog(
      context: context,
      barrierColor: Colors.black87,
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.all(20),
        child: Stack(
          children: [
            Center(
              child: Hero(
                tag: 'image_${message.id}',
                child: InteractiveViewer(
                  minScale: 0.5,
                  maxScale: 4.0,
                  child: PeersImage(
                    src: imageUrl,
                    fit: BoxFit.contain,
                  ),
                ),
              ),
            ),
            Positioned(
              top: 20,
              right: 20,
              child: IconButton(
                icon: const Icon(
                  Icons.close,
                  color: Colors.white,
                  size: 32,
                ),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
