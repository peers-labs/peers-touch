import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/repositories/actor_repository.dart';

class HomeController extends GetxController {
  final RxInt count = 0.obs;
  final RxList<String> feed = <String>[].obs;

  void increment() => count.value++;

  Future<void> loadFeed() async {
    try {
      String username = 'alice';
      if (Get.isRegistered<GlobalContext>()) {
        final gc = Get.find<GlobalContext>();
        username = gc.session?.handle ?? username;
      }
      if (Get.isRegistered<ActorRepository>()) {
        final repo = Get.find<ActorRepository>();
        final items = await repo.fetchOutbox(username: username);
        if (items.isNotEmpty) {
          final texts = items.map((e) => e['content']?.toString() ?? e['summary']?.toString() ?? '...').toList();
          feed.assignAll(texts);
          return;
        }
      }
      feed.assignAll(['Welcome to Peers Touch']);
    } catch (_) {
      feed.assignAll(['Welcome to Peers Touch']);
    }
  }

  @override
  void onInit() {
    super.onInit();
    loadFeed();
  }
}
