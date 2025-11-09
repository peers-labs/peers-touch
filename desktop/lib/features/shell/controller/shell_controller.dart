import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

class ShellController extends GetxController {
  // 当前选中的一级菜单项
  final currentMenuItem = Rx<PrimaryMenuItem?>(null);
  
  // 右侧面板可见性（默认显示折叠栏）
  final isRightPanelVisible = true.obs;
  // 右侧面板折叠状态（true=折叠，false=展开）
  final isRightPanelCollapsed = true.obs;
  // 右侧面板内容构建器
  final rightPanelBuilder = Rx<WidgetBuilder?>(null);
  // 右侧面板宽度（默认使用 UI 常量，可被页面覆盖）
  final rightPanelWidth = Rx<double>(UIKit.rightPanelWidth);
  // 是否显示折叠按钮
  final showRightPanelCollapseButton = true.obs;

  // 首帧布局完成标记，用于屏蔽首帧前的指针事件以避免命中未布局的 RenderBox
  bool didFirstLayout = false;

  // 左侧面板宽度（由 ShellThreePane 注入并维护，保持组件无状态）
  RxDouble? leftPaneWidth;
  
  // 图标hover状态管理
  final _hoveredIcons = <String, bool>{}.obs;
  
  @override
  void onInit() {
    super.onInit();
    // 初始化右侧面板状态
    isRightPanelVisible.value = false;
    
    // Ensure right panel width is properly initialized with valid bounds
    rightPanelWidth.value = UIKit.rightPanelWidth.clamp(UIKit.rightPanelMinWidth, UIKit.rightPanelMaxWidth);
    
    // 设置默认选中的菜单项（如果有头部菜单项）
    final headItems = PrimaryMenuManager.getHeadList();
    if (headItems.isNotEmpty) {
      currentMenuItem.value = headItems.first;
      update();
    }
    // 监听菜单切换，任意切换到其他中心内容时强制关闭右侧面板，避免残留
    ever<PrimaryMenuItem?>(currentMenuItem, (item) {
      if (item != null && isRightPanelVisible.value) {
        closeRightPanel();
      }
    });
  }

  // 标记首帧布局完成
  void markDidFirstLayout() {
    if (!didFirstLayout) {
      didFirstLayout = true;
      update();
    }
  }
  
  @override
  void onClose() {
    super.onClose();
  }
  
  // 切换一级菜单项
  void selectMenuItem(PrimaryMenuItem item) {
    // 切换页面时自动关闭右侧面板，避免残留
    if (isRightPanelVisible.value) {
      closeRightPanel();
    }
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
  
  // 打开右侧面板并设置内容
  void openRightPanelWith(WidgetBuilder builder, {bool clearCenter = true}) {
    rightPanelBuilder.value = builder;
    isRightPanelVisible.value = true;
    // 默认折叠（符合需求：有注入时默认折叠）
    isRightPanelCollapsed.value = true;
    if (clearCenter) {
      currentMenuItem.value = null;
    }
    update();
  }
  
  // 关闭右侧面板
  void closeRightPanel() {
    isRightPanelVisible.value = false;
    rightPanelBuilder.value = null;
    update();
  }
  
  // 切换右侧面板
  void toggleRightPanel() {
    isRightPanelVisible.value = !isRightPanelVisible.value;
  }

  // 折叠/展开控制方法
  void collapseRightPanel() {
    isRightPanelCollapsed.value = true;
    update();
  }

  void expandRightPanel() {
    isRightPanelCollapsed.value = false;
    update();
  }

  void toggleCollapseRightPanel() {
    isRightPanelCollapsed.value = !isRightPanelCollapsed.value;
    update();
  }

  /// 打开右侧面板（带选项）
  void openRightPanelWithOptions(
    WidgetBuilder builder, {
    double? width,
    bool showCollapseButton = true,
    bool clearCenter = false,
    bool collapsedByDefault = true,
  }) {
    // Ensure width is valid and within reasonable bounds
    if (width != null && width > 0) {
      rightPanelWidth.value = width.clamp(UIKit.rightPanelMinWidth, UIKit.rightPanelMaxWidth);
    } else {
      rightPanelWidth.value = UIKit.rightPanelWidth.clamp(UIKit.rightPanelMinWidth, UIKit.rightPanelMaxWidth);
    }
    showRightPanelCollapseButton.value = showCollapseButton;
    rightPanelBuilder.value = builder;
    isRightPanelVisible.value = true;
    isRightPanelCollapsed.value = collapsedByDefault;
    if (clearCenter) {
      currentMenuItem.value = null;
    }
    update();
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
        closeRightPanel();
      }
    }
  }
}