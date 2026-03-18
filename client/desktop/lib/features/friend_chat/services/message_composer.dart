import 'dart:io';
import 'package:mime/mime.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_desktop/features/shared/extensions/chat_message_extensions.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';

class MessageComposer {
  ChatMessage composeTextMessage({
    required String from,
    required String to,
    required String sessionId,
    required String content,
    String? replyToId,
  }) {
    LoggingService.debug('MessageComposer: Composing text message');
    
    return MessageBuilder.create(
      senderId: from,
      sessionId: sessionId,
      content: content,
      type: MessageType.MESSAGE_TYPE_TEXT,
      status: MessageStatus.MESSAGE_STATUS_SENDING,
      replyToId: replyToId,
    );
  }

  ChatMessage composeImageMessage({
    required String from,
    required String to,
    required String sessionId,
    required File imageFile,
    String? caption,
    String? replyToId,
  }) {
    LoggingService.debug('MessageComposer: Composing image message');
    
    final fileName = imageFile.path.split('/').last;
    final mimeType = lookupMimeType(imageFile.path) ?? 'image/jpeg';
    
    return MessageBuilder.create(
      senderId: from,
      sessionId: sessionId,
      content: caption ?? fileName,
      type: MessageType.MESSAGE_TYPE_IMAGE,
      status: MessageStatus.MESSAGE_STATUS_SENDING,
      replyToId: replyToId,
    );
  }

  ChatMessage composeFileMessage({
    required String from,
    required String to,
    required String sessionId,
    required File file,
    String? replyToId,
  }) {
    LoggingService.debug('MessageComposer: Composing file message');
    
    final fileName = file.path.split('/').last;
    final mimeType = lookupMimeType(file.path) ?? 'application/octet-stream';
    
    return MessageBuilder.create(
      senderId: from,
      sessionId: sessionId,
      content: fileName,
      type: MessageType.MESSAGE_TYPE_FILE,
      status: MessageStatus.MESSAGE_STATUS_SENDING,
      replyToId: replyToId,
    );
  }

  ChatMessage composeStickerMessage({
    required String from,
    required String to,
    required String sessionId,
    required String stickerUrl,
    required String stickerName,
    String? replyToId,
  }) {
    LoggingService.debug('MessageComposer: Composing sticker message');
    
    final message = MessageBuilder.create(
      senderId: from,
      sessionId: sessionId,
      content: stickerUrl,
      type: MessageType.MESSAGE_TYPE_STICKER,
      status: MessageStatus.MESSAGE_STATUS_SENDING,
      replyToId: replyToId,
    );
    
    return message.copyWithMetadata(
      metadata: {'stickerName': stickerName},
    );
  }

  ChatMessage composeAudioMessage({
    required String from,
    required String to,
    required String sessionId,
    required File audioFile,
    int? duration,
    String? replyToId,
  }) {
    LoggingService.debug('MessageComposer: Composing audio message');
    
    final fileName = audioFile.path.split('/').last;
    final message = MessageBuilder.create(
      senderId: from,
      sessionId: sessionId,
      content: fileName,
      type: MessageType.MESSAGE_TYPE_AUDIO,
      status: MessageStatus.MESSAGE_STATUS_SENDING,
      replyToId: replyToId,
    );
    
    if (duration != null) {
      return message.copyWithMetadata(
        metadata: {'duration': duration.toString()},
      );
    }
    
    return message;
  }

  ChatMessage composeVideoMessage({
    required String from,
    required String to,
    required String sessionId,
    required File videoFile,
    String? caption,
    String? replyToId,
  }) {
    LoggingService.debug('MessageComposer: Composing video message');
    
    final fileName = videoFile.path.split('/').last;
    
    return MessageBuilder.create(
      senderId: from,
      sessionId: sessionId,
      content: caption ?? fileName,
      type: MessageType.MESSAGE_TYPE_VIDEO,
      status: MessageStatus.MESSAGE_STATUS_SENDING,
      replyToId: replyToId,
    );
  }

  ChatMessage composeLocationMessage({
    required String from,
    required String to,
    required String sessionId,
    required double latitude,
    required double longitude,
    String? locationName,
    String? address,
    String? replyToId,
  }) {
    LoggingService.debug('MessageComposer: Composing location message');
    
    final message = MessageBuilder.create(
      senderId: from,
      sessionId: sessionId,
      content: locationName ?? 'Location',
      type: MessageType.MESSAGE_TYPE_LOCATION,
      status: MessageStatus.MESSAGE_STATUS_SENDING,
      replyToId: replyToId,
    );
    
    return message.copyWithMetadata(
      metadata: {
        'latitude': latitude.toString(),
        'longitude': longitude.toString(),
        if (locationName != null) 'locationName': locationName,
        if (address != null) 'address': address,
      },
    );
  }

  ChatMessage composeSystemMessage({
    required String sessionId,
    required String content,
  }) {
    LoggingService.debug('MessageComposer: Composing system message');
    
    return MessageBuilder.create(
      senderId: 'system',
      sessionId: sessionId,
      content: content,
      type: MessageType.MESSAGE_TYPE_SYSTEM,
      status: MessageStatus.MESSAGE_STATUS_SENT,
    );
  }
}
