import 'package:get/get.dart';

import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';

class ShellBinding extends Bindings {
  @override
  void dependencies() {
    Get.put<ShellController>(ShellController(), permanent: true);
  }
}