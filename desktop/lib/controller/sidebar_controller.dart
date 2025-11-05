import 'package:get/get.dart';

class SidebarController extends GetxController {
  var isMiddleColumnOpen = true.obs;

  void toggleMiddleColumn() {
    isMiddleColumnOpen.value = !isMiddleColumnOpen.value;
  }
}