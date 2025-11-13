import 'package:peers_touch_desktop/features/chat/domain/models/attachment.dart';

enum DeliveryState { pending, sent, failed }

class ChatMessage {
  final String id;
  final String conversationId;
  final String authorId;
  final String contentText;
  final String? contentHtml;
  final List<ChatAttachment> attachments;
  final DateTime createdAt;
  final DeliveryState deliveryState;

  const ChatMessage({
    required this.id,
    required this.conversationId,
    required this.authorId,
    required this.contentText,
    this.contentHtml,
    this.attachments = const [],
    required this.createdAt,
    this.deliveryState = DeliveryState.sent,
  });
}