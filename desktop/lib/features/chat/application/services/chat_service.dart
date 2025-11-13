import 'dart:async';
import 'package:peers_touch_desktop/core/models/storage_models.dart';
import 'package:peers_touch_desktop/features/chat/application/backends/chat_backend.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/conversation.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/message.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/user.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/attachment.dart';

class ChatService {
  final ChatBackend backend;

  ChatService({required this.backend});

  Future<Page<Conversation>> fetchConversations(QueryOptions options) => backend.fetchConversations(options);

  Future<Page<ChatMessage>> fetchMessages(String conversationId, QueryOptions options) => backend.fetchMessages(conversationId, options);

  Future<ChatMessage> sendMessage({String? conversationId, List<String>? recipients, required String text, List<ChatAttachment> attachments = const []}) => backend.sendMessage(conversationId: conversationId, recipients: recipients, text: text, attachments: attachments);

  Future<void> markRead(String conversationId) => backend.markRead(conversationId);

  Future<void> deleteConversation(String id) => backend.deleteConversation(id);

  Future<List<ChatUser>> searchAccounts(String query) => backend.searchAccounts(query);

  Stream<dynamic> subscribeDirectStream() => backend.subscribeDirectStream();
}