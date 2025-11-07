import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';

class ShellController extends GetxController {
  // 当前选中的一级菜单项
  final currentMenuItem = Rx<PrimaryMenuItem?>(null);
  
  // 右侧面板可见性
  final isRightPanelVisible = false.obs;
  
  // 图标hover状态管理
  final _hoveredIcons = <String, bool>{}.obs;
  
  @override
  void onInit() {
    super.onInit();
    // 初始化右侧面板状态
    isRightPanelVisible.value = false;
    
    // 设置默认选中的菜单项（如果有头部菜单项）
    final headItems = PrimaryMenuManager.getHeadList();
    if (headItems.isNotEmpty) {
      currentMenuItem.value = headItems.first;
      update();
    }
  }
  
  @override
  void onClose() {
    super.onClose();
  }
  
  // 切换一级菜单项
  void selectMenuItem(PrimaryMenuItem item) {
    currentMenuItem.value = item;
    update();
  }
  
  // 根据ID切换菜单项
  void selectMenuItemById(String id) {
    final item = PrimaryMenuManager.getItemById(id);
    if (item != null) {
      selectMenuItem(item);
    }
  }
  
  // 切换右侧面板
  void toggleRightPanel() {
    isRightPanelVisible.value = !isRightPanelVisible.value;
  }
  
  // 设置图标hover状态
  void setHoveredIcon(String iconId, bool isHovered) {
    _hoveredIcons[iconId] = isHovered;
  }
  
  // 检查图标是否hover
  bool isIconHovered(String iconId) {
    return _hoveredIcons[iconId] ?? false;
  }
  
  // 处理键盘事件
  void handleKeyEvent(RawKeyEvent event) {
    // 处理ESC键关闭右侧面板
    if (event.logicalKey == LogicalKeyboardKey.escape) {
      if (isRightPanelVisible.value) {
        toggleRightPanel();
      }
    }
  }
}