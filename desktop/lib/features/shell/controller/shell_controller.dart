import 'package:get/get.dart';

enum ShellScene { chat, circle, publicFeed, aiChat }

class ShellController extends GetxController {
  final selected = ShellScene.chat.obs;
  final rightCollapsed = false.obs;
  final count = 0.obs; // 为现有测试保留的占位计数

  void select(ShellScene scene) => selected.value = scene;
  void toggleRight() => rightCollapsed.toggle();
  void increment() => count.value++;
}