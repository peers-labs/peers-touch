import 'package:get/get.dart';

class HomeController extends GetxController {
  final RxInt count = 0.obs;
  final RxList<String> feed = <String>[].obs;

  void increment() => count.value++;

  Future<void> loadFeed() async {
    feed.assignAll(['Welcome to Peers Touch']);
  }

  @override
  void onInit() {
    super.onInit();
    loadFeed();
  }
}