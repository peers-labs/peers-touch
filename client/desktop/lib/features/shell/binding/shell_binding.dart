import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/ai_chat/ai_chat_module.dart';
import 'package:peers_touch_desktop/features/chat/chat_module.dart';
import 'package:peers_touch_desktop/features/discovery/discovery_module.dart';
import 'package:peers_touch_desktop/features/peers_admin/peers_admin_module.dart';
import 'package:peers_touch_desktop/features/profile/profile_module.dart';
import 'package:peers_touch_desktop/features/settings/settings_module.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';

class ShellBinding extends Bindings {
  @override
  void dependencies() {
    Get.put<ShellController>(ShellController());

    // Register Feature Modules
    SettingsModule.register();
    DiscoveryModule.register();
    AiChatModule.register();
    ChatModule.register();
    ProfileModule.register();
    PeersAdminModule.register();
  }
}
