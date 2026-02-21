import 'dart:io';
import 'package:fixnum/fixnum.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_desktop/features/friend_chat/models/message_attachment.dart' as local;
import 'package:peers_touch_desktop/features/friend_chat/models/upload_progress.dart';
import 'package:peers_touch_desktop/features/friend_chat/services/attachment_upload_service.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_base/model/domain/chat/friend_chat.pb.dart' as fc;
import 'package:peers_touch_base/network/friend_chat/friend_chat_api_service.dart';
import 'package:peers_touch_desktop/features/shared/extensions/chat_message_extensions.dart';

class MessageSendingException implements Exception {
  final String message;
  final ChatMessage? failedMessage;
  
  MessageSendingException(this.message, {this.failedMessage});

  @override
  String toString() => 'MessageSendingException: $message';
}

class MessageSendingService {
  final _attachmentUploadService = AttachmentUploadService();
  final _chatApi = FriendChatApiService();
  
  static const int maxRetries = 3;
  static const Duration retryDelay = Duration(seconds: 2);

  Future<ChatMessage> sendMessage(
    ChatMessage message, {
    required String sessionUlid,
    required String receiverDid,
    File? attachmentFile,
    Function(ChatMessage)? onMessageUpdate,
  }) async {
    try {
      LoggingService.info('MessageSendingService: Sending message type=${message.type}');

      local.MessageAttachment? attachment;
      
      if (attachmentFile != null) {
        attachment = await _uploadAttachment(
          message,
          attachmentFile,
          (progress) {
            final updatedMessage = message
                .copyWithMetadata(status: MessageStatus.MESSAGE_STATUS_SENDING)
                .withUploadProgress(progress);
            onMessageUpdate?.call(updatedMessage);
          },
        );
      }

      final sentMessage = await _sendToServer(
        message,
        sessionUlid: sessionUlid,
        receiverDid: receiverDid,
        attachment: attachment,
      );

      LoggingService.info('MessageSendingService: Message sent successfully: ${sentMessage.id}');
      return sentMessage;

    } catch (e) {
      LoggingService.error('MessageSendingService: Failed to send message: $e');
      return message.copyWithMetadata(status: MessageStatus.MESSAGE_STATUS_FAILED);
    }
  }

  Future<local.MessageAttachment> _uploadAttachment(
    ChatMessage message,
    File file,
    Function(UploadProgress) onProgress,
  ) async {
    try {
      local.MessageAttachment? attachment;

      switch (message.type) {
        case MessageType.MESSAGE_TYPE_IMAGE:
          attachment = await _attachmentUploadService.uploadImage(
            file,
            onProgress: onProgress,
          );
          break;

        case MessageType.MESSAGE_TYPE_FILE:
        case MessageType.MESSAGE_TYPE_AUDIO:
        case MessageType.MESSAGE_TYPE_VIDEO:
          attachment = await _attachmentUploadService.uploadFile(
            file,
            onProgress: onProgress,
          );
          break;

        default:
          throw MessageSendingException(
            'Unsupported attachment type: ${message.type}',
            failedMessage: message,
          );
      }

      if (attachment == null) {
        throw MessageSendingException(
          'Failed to upload attachment',
          failedMessage: message,
        );
      }

      return attachment;
    } catch (e) {
      throw MessageSendingException(
        'Attachment upload failed: $e',
        failedMessage: message,
      );
    }
  }

  Future<ChatMessage> _sendToServer(
    ChatMessage message, {
    required String sessionUlid,
    required String receiverDid,
    local.MessageAttachment? attachment,
  }) async {
    try {
      LoggingService.info('MessageSendingService: Sending message to server type=${message.type}');

      final friendMessageType = _mapMessageTypeToProto(message.type);
      
      String content = message.content;
      if (attachment != null) {
        content = attachment.url;
      }

      final response = await _chatApi.sendMessage(
        sessionUlid: sessionUlid,
        receiverDid: receiverDid,
        content: content,
        type: friendMessageType,
        replyToUlid: message.replyToId.isNotEmpty ? message.replyToId : null,
      );

      LoggingService.info('MessageSendingService: Server response received, ulid=${response.message.ulid}');

      final sentMessage = message.copyWithMetadata(
        id: response.message.ulid,
        status: MessageStatus.MESSAGE_STATUS_SENT,
      );
      
      if (attachment != null) {
        String mimeType = 'application/octet-stream';
        switch (attachment.type) {
          case local.AttachmentType.IMAGE:
            mimeType = 'image/jpeg';
            break;
          case local.AttachmentType.VIDEO:
            mimeType = 'video/mp4';
            break;
          case local.AttachmentType.AUDIO:
            mimeType = 'audio/mpeg';
            break;
          case local.AttachmentType.FILE:
            mimeType = 'application/octet-stream';
            break;
          default:
            mimeType = 'application/octet-stream';
        }
        
        final protoAttachment = MessageAttachment()
          ..id = DateTime.now().millisecondsSinceEpoch.toString()
          ..name = attachment.fileName ?? 'file'
          ..url = attachment.url
          ..type = mimeType
          ..size = Int64(attachment.fileSize ?? 0)
          ..thumbnailUrl = attachment.thumbnailUrl ?? '';
        
        return sentMessage.copyWithMetadata(
          attachments: [protoAttachment],
        );
      }
      
      return sentMessage;
    } catch (e) {
      LoggingService.error('MessageSendingService: Server error: $e');
      throw MessageSendingException(
        'Failed to send message to server: $e',
        failedMessage: message,
      );
    }
  }

  fc.FriendMessageType _mapMessageTypeToProto(MessageType type) {
    switch (type) {
      case MessageType.MESSAGE_TYPE_TEXT:
        return fc.FriendMessageType.FRIEND_MESSAGE_TYPE_TEXT;
      case MessageType.MESSAGE_TYPE_IMAGE:
        return fc.FriendMessageType.FRIEND_MESSAGE_TYPE_IMAGE;
      case MessageType.MESSAGE_TYPE_FILE:
        return fc.FriendMessageType.FRIEND_MESSAGE_TYPE_FILE;
      case MessageType.MESSAGE_TYPE_AUDIO:
        return fc.FriendMessageType.FRIEND_MESSAGE_TYPE_AUDIO;
      case MessageType.MESSAGE_TYPE_VIDEO:
        return fc.FriendMessageType.FRIEND_MESSAGE_TYPE_VIDEO;
      case MessageType.MESSAGE_TYPE_STICKER:
      case MessageType.MESSAGE_TYPE_LOCATION:
      case MessageType.MESSAGE_TYPE_SYSTEM:
        return fc.FriendMessageType.FRIEND_MESSAGE_TYPE_TEXT;
      default:
        return fc.FriendMessageType.FRIEND_MESSAGE_TYPE_TEXT;
    }
  }

  bool validateMessage(ChatMessage message) {
    if (message.type == MessageType.MESSAGE_TYPE_TEXT) {
      return message.content.trim().isNotEmpty;
    }

    if ([
      MessageType.MESSAGE_TYPE_IMAGE,
      MessageType.MESSAGE_TYPE_FILE,
      MessageType.MESSAGE_TYPE_AUDIO,
      MessageType.MESSAGE_TYPE_VIDEO
    ].contains(message.type)) {
      return message.hasAttachments;
    }

    return true;
  }

  Future<ChatMessage> retryMessage(
    ChatMessage failedMessage, {
    required String sessionUlid,
    required String receiverDid,
  }) async {
    if (failedMessage.status != MessageStatus.MESSAGE_STATUS_FAILED) {
      throw ArgumentError('Can only retry failed messages');
    }

    LoggingService.info('MessageSendingService: Retrying failed message ${failedMessage.id}');
    return await sendMessage(
      failedMessage,
      sessionUlid: sessionUlid,
      receiverDid: receiverDid,
    );
  }
}
