import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/models/storage_models.dart';
import 'package:peers_touch_desktop/features/chat/application/services/chat_service.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/conversation.dart';

class ChatListController extends GetxController {
  final ChatService service;
  ChatListController({required this.service});

  final conversations = <Conversation>[].obs;
  final selectedId = ''.obs;

  @override
  void onInit() {
    super.onInit();
    loadConversations();
  }

  Future<void> loadConversations() async {
    final page = await service.fetchConversations(QueryOptions(page: 1, pageSize: 50));
    conversations.assignAll(page.items);
    if (selectedId.value.isEmpty && conversations.isNotEmpty) {
      selectedId.value = conversations.first.id;
    }
  }

  void selectConversation(String id) {
    selectedId.value = id;
  }
}