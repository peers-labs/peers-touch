import 'dart:io';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_desktop/features/friend_chat/services/message_composer.dart';
import 'package:peers_touch_desktop/features/friend_chat/services/message_sending_service.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_desktop/features/shared/extensions/chat_message_extensions.dart';

class ChatMessageService {
  final _composer = MessageComposer();
  final _sendingService = MessageSendingService();

  Future<ChatMessage> sendTextMessage({
    required String from,
    required String to,
    required String sessionUlid,
    required String content,
    String? replyToId,
    Function(ChatMessage)? onUpdate,
  }) async {
    try {
      LoggingService.info('ChatMessageService: Sending text message');

      final message = _composer.composeTextMessage(
        from: from,
        to: to,
        sessionId: sessionUlid,
        content: content,
        replyToId: replyToId,
      );

      final sentMessage = await _sendingService.sendMessage(
        message,
        sessionUlid: sessionUlid,
        receiverDid: to,
      );

      LoggingService.info('ChatMessageService: Text message sent successfully');
      return sentMessage;
    } catch (e) {
      LoggingService.error('ChatMessageService: Failed to send text message: $e');
      rethrow;
    }
  }

  Future<ChatMessage> sendImageMessage({
    required String from,
    required String to,
    required String sessionUlid,
    required File imageFile,
    String? caption,
    String? replyToId,
    Function(ChatMessage)? onUpdate,
  }) async {
    try {
      LoggingService.info('ChatMessageService: Sending image message');

      final message = _composer.composeImageMessage(
        from: from,
        to: to,
        sessionId: sessionUlid,
        imageFile: imageFile,
        caption: caption,
        replyToId: replyToId,
      );

      onUpdate?.call(message);

      final sentMessage = await _sendingService.sendMessage(
        message,
        sessionUlid: sessionUlid,
        receiverDid: to,
        attachmentFile: imageFile,
        onMessageUpdate: (updatedMessage) {
          LoggingService.info(
            'ChatMessageService: Image upload progress: ${updatedMessage.uploadProgress?.percentage ?? 0}',
          );
          onUpdate?.call(updatedMessage);
        },
      );

      LoggingService.info('ChatMessageService: Image message sent successfully');
      return sentMessage;
    } catch (e) {
      LoggingService.error('ChatMessageService: Failed to send image message: $e');
      rethrow;
    }
  }

  Future<ChatMessage> sendFileMessage({
    required String from,
    required String to,
    required String sessionUlid,
    required File file,
    String? replyToId,
    Function(ChatMessage)? onUpdate,
  }) async {
    try {
      LoggingService.info('ChatMessageService: Sending file message');

      final message = _composer.composeFileMessage(
        from: from,
        to: to,
        sessionId: sessionUlid,
        file: file,
        replyToId: replyToId,
      );

      onUpdate?.call(message);

      final sentMessage = await _sendingService.sendMessage(
        message,
        sessionUlid: sessionUlid,
        receiverDid: to,
        attachmentFile: file,
        onMessageUpdate: (updatedMessage) {
          LoggingService.info(
            'ChatMessageService: File upload progress: ${updatedMessage.uploadProgress?.percentage ?? 0}',
          );
          onUpdate?.call(updatedMessage);
        },
      );

      LoggingService.info('ChatMessageService: File message sent successfully');
      return sentMessage;
    } catch (e) {
      LoggingService.error('ChatMessageService: Failed to send file message: $e');
      rethrow;
    }
  }

  Future<ChatMessage> sendStickerMessage({
    required String from,
    required String to,
    required String sessionUlid,
    required String stickerUrl,
    required String stickerName,
    String? replyToId,
    Function(ChatMessage)? onUpdate,
  }) async {
    try {
      LoggingService.info('ChatMessageService: Sending sticker message');

      final message = _composer.composeStickerMessage(
        from: from,
        to: to,
        sessionId: sessionUlid,
        stickerUrl: stickerUrl,
        stickerName: stickerName,
        replyToId: replyToId,
      );

      final sentMessage = await _sendingService.sendMessage(
        message,
        sessionUlid: sessionUlid,
        receiverDid: to,
      );

      LoggingService.info('ChatMessageService: Sticker message sent successfully');
      return sentMessage;
    } catch (e) {
      LoggingService.error('ChatMessageService: Failed to send sticker message: $e');
      rethrow;
    }
  }

  Future<ChatMessage> sendAudioMessage({
    required String from,
    required String to,
    required String sessionUlid,
    required File audioFile,
    int? duration,
    String? replyToId,
    Function(ChatMessage)? onUpdate,
  }) async {
    try {
      LoggingService.info('ChatMessageService: Sending audio message');

      final message = _composer.composeAudioMessage(
        from: from,
        to: to,
        sessionId: sessionUlid,
        audioFile: audioFile,
        duration: duration,
        replyToId: replyToId,
      );

      onUpdate?.call(message);

      final sentMessage = await _sendingService.sendMessage(
        message,
        sessionUlid: sessionUlid,
        receiverDid: to,
        attachmentFile: audioFile,
        onMessageUpdate: (updatedMessage) {
          onUpdate?.call(updatedMessage);
        },
      );

      LoggingService.info('ChatMessageService: Audio message sent successfully');
      return sentMessage;
    } catch (e) {
      LoggingService.error('ChatMessageService: Failed to send audio message: $e');
      rethrow;
    }
  }

  Future<ChatMessage> sendVideoMessage({
    required String from,
    required String to,
    required String sessionUlid,
    required File videoFile,
    String? caption,
    String? replyToId,
    Function(ChatMessage)? onUpdate,
  }) async {
    try {
      LoggingService.info('ChatMessageService: Sending video message');

      final message = _composer.composeVideoMessage(
        from: from,
        to: to,
        sessionId: sessionUlid,
        videoFile: videoFile,
        caption: caption,
        replyToId: replyToId,
      );

      onUpdate?.call(message);

      final sentMessage = await _sendingService.sendMessage(
        message,
        sessionUlid: sessionUlid,
        receiverDid: to,
        attachmentFile: videoFile,
        onMessageUpdate: (updatedMessage) {
          onUpdate?.call(updatedMessage);
        },
      );

      LoggingService.info('ChatMessageService: Video message sent successfully');
      return sentMessage;
    } catch (e) {
      LoggingService.error('ChatMessageService: Failed to send video message: $e');
      rethrow;
    }
  }

  Future<ChatMessage> retryFailedMessage(
    ChatMessage failedMessage, {
    required String sessionUlid,
    required String receiverDid,
  }) async {
    try {
      LoggingService.info('ChatMessageService: Retrying failed message');
      return await _sendingService.retryMessage(
        failedMessage,
        sessionUlid: sessionUlid,
        receiverDid: receiverDid,
      );
    } catch (e) {
      LoggingService.error('ChatMessageService: Failed to retry message: $e');
      rethrow;
    }
  }
}
