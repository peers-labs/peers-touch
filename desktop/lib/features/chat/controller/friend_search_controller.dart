import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/chat/application/services/chat_service.dart';
import 'package:peers_touch_desktop/features/chat/domain/models/user.dart';

class FriendSearchController extends GetxController {
  final ChatService service;
  FriendSearchController({required this.service});

  final query = ''.obs;
  final results = <ChatUser>[].obs;
  final isLoading = false.obs;

  Future<void> search(String q) async {
    query.value = q;
    if (q.trim().isEmpty) {
      results.clear();
      return;
    }
    isLoading.value = true;
    try {
      final list = await service.searchAccounts(q);
      results.assignAll(list);
    } finally {
      isLoading.value = false;
    }
  }
}