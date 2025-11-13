import 'package:get/get.dart';
import 'controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/settings/settings_module.dart';
// 同步注册 AIChat 模块示例
import 'package:peers_touch_desktop/features/ai_chat/ai_chat_module.dart';
import 'package:peers_touch_desktop/features/profile/profile_module.dart';
import 'package:peers_touch_desktop/features/peers_admin/peers_admin_module.dart';
import 'package:peers_touch_desktop/features/chat/chat_module.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';

class ShellBinding extends Bindings {
  @override
  void dependencies() {
    // 先注册系统/业务模块的一级菜单项
    // 系统模块：设置（尾部区域）
    SettingsModule.register();
    // 业务模块示例：AI对话（头部区域）
    AIChatModule.register();
    // 业务模块：社交聊天
    ChatModule.register();
    // 业务模块：个人主页（头部区域，含头像块点击）
    ProfileModule.register();
    // 业务模块：Peers Admin（头部区域）
    PeersAdminModule.register();

    // 再注入 ShellController，确保其读取到已注册的菜单项
    Get.put<ShellController>(ShellController(), permanent: true);

    // 启动后尝试触发一次本地->云端同步（根据设置与模式）
    Future.microtask(() async {
      try {
        final sync = Get.find<StorageSyncService>();
        await sync.syncAllIfEnabled();
      } catch (_) {}
    });
  }
}