import 'dart:async';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/models/storage_models.dart';
import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_desktop/features/chat/application/backends/chat_backend.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/conversation.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/message.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/user.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/attachment.dart';

class SocialBackendAdapter implements ChatBackend {
  final ApiClient api;
  final String baseUrl;

  SocialBackendAdapter({ApiClient? apiClient, required this.baseUrl}) : api = apiClient ?? Get.find<ApiClient>();

  @override
  Future<Page<Conversation>> fetchConversations(QueryOptions options) async {
    return Page<Conversation>(items: [], page: options.page, pageSize: options.pageSize, total: 0);
  }

  @override
  Future<Page<ChatMessage>> fetchMessages(String conversationId, QueryOptions options) async {
    return Page<ChatMessage>(items: [], page: options.page, pageSize: options.pageSize, total: 0);
  }

  @override
  Future<ChatMessage> sendMessage({String? conversationId, List<String>? recipients, required String text, List<ChatAttachment> attachments = const []}) async {
    return ChatMessage(id: DateTime.now().millisecondsSinceEpoch.toString(), conversationId: conversationId ?? '', authorId: 'me', contentText: text, attachments: attachments, createdAt: DateTime.now());
  }

  @override
  Future<void> markRead(String conversationId) async {}

  @override
  Future<void> deleteConversation(String id) async {}

  @override
  Future<List<ChatUser>> searchAccounts(String query) async {
    return [];
  }

  @override
  Stream<dynamic> subscribeDirectStream() {
    return const Stream.empty();
  }
}