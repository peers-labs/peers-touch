import 'package:get/get.dart';
import 'controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'package:peers_touch_desktop/features/settings/settings_module.dart';
import 'package:peers_touch_desktop/features/ai_chat/ai_chat_module.dart';
import 'package:peers_touch_desktop/features/chat/chat_module.dart';
import 'package:peers_touch_desktop/features/profile/profile_module.dart';
import 'package:peers_touch_desktop/features/peers_admin/peers_admin_module.dart';
import 'package:peers_touch_desktop/features/discovery/discovery_module.dart';

class ShellBinding extends Bindings {
  @override
  void dependencies() {
    // 每次进入 Shell 前重建菜单：清空后按当前用户上下文重新注册
    PrimaryMenuManager.clearAll();

    // 系统模块：设置（尾部区域）
    SettingsModule.register();
    // 业务模块：发现（头部区域）
    DiscoveryModule.register();
    // 业务模块示例：AI对话（头部区域）
    AIChatModule.register();
    // 业务模块：RTC聊天（头部区域）
    ChatModule.register();
    // 业务模块：个人主页（头部区域，含头像块点击）
    ProfileModule.register();
    // 业务模块：Peers Admin（头部区域）
    PeersAdminModule.register();

    // 注入或更新 ShellController（避免重复创建）
    if (Get.isRegistered<ShellController>()) {
      final sc = Get.find<ShellController>();
      final head = PrimaryMenuManager.getHeadList();
      if (head.isNotEmpty) {
        sc.selectMenuItem(head.first);
      }
    } else {
      Get.put<ShellController>(ShellController(), permanent: true);
    }
  }
}
