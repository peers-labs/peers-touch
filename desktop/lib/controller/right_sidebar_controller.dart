import 'package:get/get.dart';

class RightSidebarController extends GetxController {
  var isOpen = false.obs;

  void toggle() {
    isOpen.value = !isOpen.value;
  }
}