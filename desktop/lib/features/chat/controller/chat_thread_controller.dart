import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/models/storage_models.dart';
import 'package:peers_touch_desktop/features/chat/application/services/chat_service.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/message.dart';

class ChatThreadController extends GetxController {
  final ChatService service;
  ChatThreadController({required this.service});

  final messages = <ChatMessage>[].obs;
  final currentConversationId = ''.obs;

  Future<void> loadMessages(String conversationId) async {
    currentConversationId.value = conversationId;
    final page = await service.fetchMessages(conversationId, QueryOptions(page: 1, pageSize: 50));
    messages.assignAll(page.items);
  }

  Future<void> sendText(String text) async {
    final id = currentConversationId.value;
    if (id.isEmpty) return;
    final msg = await service.sendMessage(conversationId: id, text: text);
    messages.add(msg);
  }
}