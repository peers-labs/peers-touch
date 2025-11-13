import 'dart:async';
import 'package:peers_touch_desktop/core/models/storage_models.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/conversation.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/message.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/user.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/attachment.dart';

abstract class ChatBackend {
  Future<Page<Conversation>> fetchConversations(QueryOptions options);

  Future<Page<ChatMessage>> fetchMessages(String conversationId, QueryOptions options);

  Future<ChatMessage> sendMessage({
    String? conversationId,
    List<String>? recipients,
    required String text,
    List<ChatAttachment> attachments,
  });

  Future<void> markRead(String conversationId);

  Future<void> deleteConversation(String id);

  Future<List<ChatUser>> searchAccounts(String query);

  Stream<dynamic> subscribeDirectStream();
}