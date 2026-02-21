import 'package:flutter/material.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/message_types/image_message_bubble.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/message_types/file_message_bubble.dart';

/// Factory class for creating message bubbles based on message type.
/// 
/// This implements the Factory Pattern to centralize message rendering logic
/// and avoid scattered switch statements throughout the codebase.
/// 
/// Usage:
/// ```dart
/// Widget bubble = MessageBubbleFactory.createBubble(
///   message: message,
///   isMe: true,
///   onRetry: () => controller.retryFailedMessage(message),
/// );
/// ```
class MessageBubbleFactory {
  MessageBubbleFactory._();

  /// Creates the appropriate message bubble widget based on message type.
  /// 
  /// Parameters:
  /// - [message]: The chat message to render
  /// - [isMe]: Whether this is sent by current user
  /// - [onRetry]: Callback for retrying failed messages
  /// - [onImageTap]: Callback when image is tapped (for preview)
  /// - [onFileTap]: Callback when file is tapped (for download)
  /// - [onStickerTap]: Callback when sticker is tapped
  static Widget createBubble({
    required ChatMessage message,
    required bool isMe,
    VoidCallback? onRetry,
    VoidCallback? onImageTap,
    VoidCallback? onFileTap,
    VoidCallback? onStickerTap,
  }) {
    switch (message.type) {
      case MessageType.MESSAGE_TYPE_TEXT:
        return _TextMessageBubble(
          message: message,
          isMe: isMe,
          onRetry: onRetry,
        );

      case MessageType.MESSAGE_TYPE_IMAGE:
        return ImageMessageBubble(
          message: message,
          isMe: isMe,
          onRetry: onRetry,
        );

      case MessageType.MESSAGE_TYPE_FILE:
        return FileMessageBubble(
          message: message,
          isMe: isMe,
          onRetry: onRetry,
        );

      case MessageType.MESSAGE_TYPE_STICKER:
        return _StickerMessageBubble(
          message: message,
          isMe: isMe,
          onRetry: onRetry,
          onTap: onStickerTap,
        );

      case MessageType.MESSAGE_TYPE_AUDIO:
        return _AudioMessageBubble(
          message: message,
          isMe: isMe,
          onRetry: onRetry,
        );

      case MessageType.MESSAGE_TYPE_VIDEO:
        return _VideoMessageBubble(
          message: message,
          isMe: isMe,
          onRetry: onRetry,
        );

      case MessageType.MESSAGE_TYPE_LOCATION:
        return _LocationMessageBubble(
          message: message,
          isMe: isMe,
        );

      case MessageType.MESSAGE_TYPE_SYSTEM:
        return _SystemMessageBubble(
          message: message,
        );

      default:
        return _UnsupportedMessageBubble(
          message: message,
          isMe: isMe,
        );
    }
  }


}

// =============================================================================
// Internal Bubble Implementations
// =============================================================================

/// Text message bubble (already implemented inline in ChatMessageItem)
class _TextMessageBubble extends StatelessWidget {
  const _TextMessageBubble({
    required this.message,
    required this.isMe,
    this.onRetry,
  });

  final ChatMessage message;
  final bool isMe;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Container(
      constraints: BoxConstraints(
        minWidth: 40,
        maxWidth: MediaQuery.of(context).size.width * 0.6,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: 12,
        vertical: 8,
      ),
      decoration: BoxDecoration(
        color: isMe
            ? theme.colorScheme.primaryContainer
            : theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: SelectableText(
        message.content,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: isMe
              ? theme.colorScheme.onPrimaryContainer
              : theme.colorScheme.onSurface,
        ),
      ),
    );
  }
}

/// Sticker message bubble (emoji/animated sticker)
class _StickerMessageBubble extends StatelessWidget {
  const _StickerMessageBubble({
    required this.message,
    required this.isMe,
    this.onRetry,
    this.onTap,
  });

  final ChatMessage message;
  final bool isMe;
  final VoidCallback? onRetry;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final stickerUrl = message.metadata['stickerUrl'] ?? message.content;
    
    return GestureDetector(
      onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(
          maxWidth: 200,
          maxHeight: 200,
        ),
        child: stickerUrl.startsWith('http')
            ? Image.network(
                stickerUrl,
                fit: BoxFit.contain,
                errorBuilder: (context, error, stackTrace) {
                  return Container(
                    width: 100,
                    height: 100,
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.errorContainer,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      Icons.broken_image,
                      color: Theme.of(context).colorScheme.onErrorContainer,
                    ),
                  );
                },
              )
            : Text(
                stickerUrl, // Emoji
                style: const TextStyle(fontSize: 64),
              ),
      ),
    );
  }
}

/// Audio message bubble (voice message)
class _AudioMessageBubble extends StatelessWidget {
  const _AudioMessageBubble({
    required this.message,
    required this.isMe,
    this.onRetry,
  });

  final ChatMessage message;
  final bool isMe;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final duration = message.metadata['duration'] ?? '0:00';
    
    return Container(
      constraints: const BoxConstraints(
        maxWidth: 300,
      ),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isMe
            ? theme.colorScheme.primaryContainer
            : theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: theme.colorScheme.primary,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.play_arrow,
              color: theme.colorScheme.onPrimary,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  height: 24,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Center(
                    child: Text('Waveform placeholder'),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  duration,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: isMe
                        ? theme.colorScheme.onPrimaryContainer
                        : theme.colorScheme.onSurface,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Video message bubble
class _VideoMessageBubble extends StatelessWidget {
  const _VideoMessageBubble({
    required this.message,
    required this.isMe,
    this.onRetry,
  });

  final ChatMessage message;
  final bool isMe;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final thumbnailUrl = message.metadata['thumbnailUrl'] ?? '';
    final duration = message.metadata['duration'] ?? '0:00';
    
    return Container(
      constraints: BoxConstraints(
        maxWidth: MediaQuery.of(context).size.width * 0.4,
        maxHeight: 300,
      ),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: theme.colorScheme.outline.withValues(alpha: 0.2),
        ),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: thumbnailUrl.isNotEmpty
                ? Image.network(
                    thumbnailUrl,
                    fit: BoxFit.cover,
                    width: double.infinity,
                    height: double.infinity,
                    errorBuilder: (context, error, stackTrace) {
                      return Container(
                        width: 200,
                        height: 150,
                        color: theme.colorScheme.surfaceContainerHighest,
                        child: const Icon(Icons.video_library, size: 48),
                      );
                    },
                  )
                : Container(
                    width: 200,
                    height: 150,
                    color: theme.colorScheme.surfaceContainerHighest,
                    child: const Icon(Icons.video_library, size: 48),
                  ),
          ),
          Container(
            width: 60,
            height: 60,
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.6),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.play_arrow,
              color: Colors.white,
              size: 40,
            ),
          ),
          Positioned(
            bottom: 8,
            right: 8,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                duration,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Location message bubble
class _LocationMessageBubble extends StatelessWidget {
  const _LocationMessageBubble({
    required this.message,
    required this.isMe,
  });

  final ChatMessage message;
  final bool isMe;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final locationName = message.metadata['locationName'] ?? 'Location';
    final address = message.metadata['address'] ?? '';
    
    return Container(
      constraints: BoxConstraints(
        maxWidth: MediaQuery.of(context).size.width * 0.5,
      ),
      decoration: BoxDecoration(
        color: isMe
            ? theme.colorScheme.primaryContainer
            : theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: 120,
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHigh,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
            ),
            child: const Center(
              child: Icon(Icons.map, size: 48),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  locationName,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                    color: isMe
                        ? theme.colorScheme.onPrimaryContainer
                        : theme.colorScheme.onSurface,
                  ),
                ),
                if (address.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    address,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: isMe
                          ? theme.colorScheme.onPrimaryContainer.withValues(alpha: 0.7)
                          : theme.colorScheme.onSurface.withValues(alpha: 0.7),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// System message bubble (for notifications like "User joined")
class _SystemMessageBubble extends StatelessWidget {
  const _SystemMessageBubble({
    required this.message,
  });

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          message.content,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}

/// Fallback for unsupported message types
class _UnsupportedMessageBubble extends StatelessWidget {
  const _UnsupportedMessageBubble({
    required this.message,
    required this.isMe,
  });

  final ChatMessage message;
  final bool isMe;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.errorContainer.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: theme.colorScheme.error.withValues(alpha: 0.5),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.warning_amber_rounded,
            color: theme.colorScheme.error,
            size: 20,
          ),
          const SizedBox(width: 8),
          Text(
            'Unsupported message type: ${message.type}',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onErrorContainer,
            ),
          ),
        ],
      ),
    );
  }
}
