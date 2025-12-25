import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/applet/models/applet_manifest.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/core/constants/app_constants.dart';
import 'package:peers_touch_desktop/features/shell/controller/right_panel_mode.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'package:peers_touch_desktop/features/shell/view/widgets/applet_dock.dart';
import 'package:peers_touch_desktop/modules/applet_launcher/view/applet_container.dart';

class ShellPage extends StatelessWidget {
  const ShellPage({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = theme.extension<WeChatTokens>()!;
    final localizations = AppLocalizations.of(context);

    return GetBuilder<ShellController>(
      builder: (controller) {
        // 首帧完成后再允许指针事件，避免刚启动时命中未布局的 RenderBox
        if (!controller.didFirstLayout) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            controller.markDidFirstLayout();
          });
        }
        return Scaffold(
          backgroundColor: tokens.bgLevel0,
          floatingActionButton: null,
          body: Listener(
            onPointerDown: (event) => _handleGlobalTap(context, controller, event),
            behavior: HitTestBehavior.translucent,
            child: Focus(
              focusNode: controller.focusNode,
              autofocus: false,
              canRequestFocus: false, // 仅用于监听冒泡事件（如ESC），不主动抢占焦点，避免干扰输入框
              onKeyEvent: controller.handleKeyEvent,
              child: Padding(
              padding: EdgeInsets.only(
                top: (Theme.of(context).platform == TargetPlatform.macOS)
                    ? AppConstants.macOSTitleBarHeight
                    : 0,
              ),
              child: LayoutBuilder(
                builder: (ctx, constraints) {
                  final viewportH = constraints.maxHeight.isFinite
                      ? constraints.maxHeight
                      : MediaQuery.of(ctx).size.height;
                  return Row(
                    children: [
                      // 左侧一级菜单栏：受父高度约束
                      SizedBox(
                        height: viewportH,
                        child: _buildPrimaryMenuBar(context, controller, theme),
                      ),
                      // 主内容区 + 右侧面板（支持 Stack 叠加）
                      Expanded(
                        child: Stack(
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: LayoutBuilder(
                                    builder: (context, constraints) {
                                      return _buildContentArea(context, controller, theme, localizations);
                                    },
                                  ),
                                ),
                                // 挤压模式下的右侧面板占位
                                Obx(() {
                                  if (!controller.isRightPanelVisible.value || 
                                      controller.rightPanelMode.value != RightPanelMode.squeeze) {
                                    return const SizedBox.shrink();
                                  }
                                  return _buildRightPanelWrapper(context, controller, theme, viewportH);
                                }),
                              ],
                            ),
                            // 覆盖模式下的右侧面板
                            Obx(() {
                              if (!controller.isRightPanelVisible.value || 
                                  controller.rightPanelMode.value != RightPanelMode.cover) {
                                return const SizedBox.shrink();
                              }
                              return Positioned(
                                right: 0,
                                top: 0,
                                bottom: 0,
                                child: Container(
                                  decoration: BoxDecoration(
                                    boxShadow: [
                                      BoxShadow(
                                        color: Colors.black.withOpacity(0.1),
                                        blurRadius: 10,
                                        offset: const Offset(-2, 0),
                                      ),
                                    ],
                                  ),
                                  child: _buildRightPanelWrapper(context, controller, theme, viewportH),
                                ),
                              );
                            }),
                          ],
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
          ),
        );
      },
    );
  }

  Widget _buildPrimaryMenuBar(BuildContext context, ShellController controller, ThemeData theme) {
    final tokens = theme.extension<WeChatTokens>()!;
    final viewportH = MediaQuery.of(context).size.height;
    return SizedBox(
      height: viewportH,
      child: Container(
        width: tokens.menuBarWidth, // 一级菜单栏固定宽度（来自主题tokens，避免硬编码）
        decoration: BoxDecoration(
          color: tokens.bgLevel2, // 功能区背景色
          border: Border(right: BorderSide(color: tokens.divider, width: 1)),
        ),
        child: Column(
          children: [
          // 头像块区域 - 固定80px（最顶部）
          _buildAvatarBlock(context, controller, theme),
          
          // 头部区域 - 自适应高度（业务功能菜单）
          Flexible(
            fit: FlexFit.tight,
            child: _buildHeadMenuArea(context, controller, theme),
          ),
          
          // Pinned Applets Dock
          Builder(builder: (context) {
            return Obx(() {
              // Explicitly access the list to register dependency for GetX
              final applets = controller.pinnedApplets.toList();
              return PinnedAppletsDock(
                pinnedApplets: applets,
                onAppletTap: (applet) {
                   // Open Applet using Keep-Alive mechanism
                   controller.openApplet(applet);
                },
                onReorder: (oldIndex, newIndex) {
                  if (oldIndex < newIndex) {
                    newIndex -= 1;
                  }
                  final item = controller.pinnedApplets.removeAt(oldIndex);
                  controller.pinnedApplets.insert(newIndex, item);
                },
              );
            });
          }),

          // 尾部区域 - 固定80px（最底部，重要入口）
          _buildTailMenuArea(context, controller, theme),
          ],
        ),
      ),
    );
  }

  Widget _buildAvatarBlock(BuildContext context, ShellController controller, ThemeData theme) {
    final tokens = theme.extension<WeChatTokens>()!;
    final avatarBuilder = PrimaryMenuManager.getAvatarBlockBuilder();
    
    return Container(
      height: UIKit.avatarBlockHeight, // 固定高度
      color: tokens.bgLevel2, // 头像块背景色
      child: avatarBuilder != null 
          ? Builder(builder: avatarBuilder)
          : Container(
              color: tokens.bgLevel2, // 默认头像块背景
              child: Center(
                child: Icon(Icons.person, color: tokens.textPrimary, size: 32),
              ),
            ),
    );
  }

  Widget _buildHeadMenuArea(BuildContext context, ShellController controller, ThemeData theme) {
    final tokens = theme.extension<WeChatTokens>()!;
    final headItems = PrimaryMenuManager.getHeadList();
    
    return Container(
      color: tokens.bgLevel2, // 头部区域背景色
      child: ListView.builder(
        itemCount: headItems.length,
        itemBuilder: (context, index) {
          final item = headItems[index];
          final isSelected = controller.currentMenuItem.value?.id == item.id;
          
          return _buildMenuIcon(context, item, isSelected, controller, theme);
        },
      ),
    );
  }

  Widget _buildTailMenuArea(BuildContext context, ShellController controller, ThemeData theme) {
    final tokens = theme.extension<WeChatTokens>()!;
    final tailItems = PrimaryMenuManager.getTailList();

    return Container(
      height: UIKit.avatarBlockHeight, // 固定高度
      color: tokens.bgLevel2, // 尾部区域背景色
      child: ListView(
        padding: EdgeInsets.zero,
        children: tailItems.map((item) {
          final isSelected = controller.currentMenuItem.value?.id == item.id;
          return _buildMenuIcon(context, item, isSelected, controller, theme);
        }).toList(),
      ),
    );
  }

  Widget _buildMenuIcon(BuildContext context, PrimaryMenuItem item, bool isSelected, ShellController controller, ThemeData theme) {
    final tokens = theme.extension<WeChatTokens>()!;
    final double barWidth = tokens.menuBarWidth; // 从 tokens 读取栏宽
    final double boxSize = barWidth * tokens.menuItemBoxRatio; // 黄金分割比例尺寸（从 tokens 读取）
    final double horizontalMargin = (barWidth - boxSize) / 2; // 居中，左右留白更大

    final localizations = AppLocalizations.of(context);
    String tooltip = item.label;
    if (localizations != null) {
      switch (item.id) {
        case 'settings':
          tooltip = localizations.settingsTitle;
          break;
        case 'ai_chat':
          tooltip = localizations.aiChat;
          break;
        case 'chat_rtc':
          tooltip = localizations.chatRtc;
          break;
        case 'discovery':
          tooltip = localizations.discovery;
          break;
      }
    }

    return Tooltip(
      message: tooltip,
      child: Container(
        height: boxSize,
        width: boxSize,
        margin: EdgeInsets.symmetric(vertical: tokens.spaceXs, horizontal: horizontalMargin),
        decoration: BoxDecoration(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(tokens.radiusMd),
          border: Border.all(
            color: isSelected ? tokens.divider : Colors.transparent,
            width: 1,
          ),
        ),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => controller.selectMenuItem(item),
          child: Center(
            child: Icon(item.icon, color: tokens.textPrimary, size: 22),
          ),
        ),
      ),
    );
  }

  Widget _buildContentArea(BuildContext context, ShellController controller, ThemeData theme, AppLocalizations? localizations) {
    final tokens = theme.extension<WeChatTokens>()!;
    
    return Obx(() {
      final activeId = controller.activeAppletId.value;
      // Explicitly convert to list to ensure GetX dependency registration
      final running = controller.runningApplets.toList();
      final currentItem = controller.currentMenuItem.value;
      
      int stackIndex = 0;
      if (activeId != null) {
        final index = running.indexWhere((m) => m.appId == activeId);
        if (index != -1) {
          stackIndex = index + 1;
        }
      }

      return IndexedStack(
        index: stackIndex,
        children: [
          // Index 0: Dashboard Content
          Container(
            color: tokens.bgLevel1,
            child: currentItem != null
                ? Builder(builder: currentItem.contentBuilder) 
                : Container(color: tokens.bgLevel1),
          ),
          
          // Index 1..N: Running Applets
          ...running.map((manifest) {
            return _buildAppletWrapper(context, controller, theme, manifest);
          }),
        ],
      );
    });
  }

  Widget _buildAppletWrapper(BuildContext context, ShellController controller, ThemeData theme, AppletManifest manifest) {
    final tokens = theme.extension<WeChatTokens>()!;
    // Using local Hello World example to ensure it loads.
    // Use triple slash to ensure path is correctly parsed: assets:///assets/webf/hello.js
    const mockUrl = 'assets:///assets/webf/hello.js';

    return Container(
      color: tokens.bgLevel0,
      child: Column(
        children: [
          // Applet Header
          Container(
            height: 40,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              color: tokens.bgLevel2,
              border: Border(bottom: BorderSide(color: tokens.divider)),
            ),
            child: Row(
              children: [
                // Close Button
                IconButton(
                  icon: Icon(Icons.close, size: 18, color: tokens.textSecondary),
                  onPressed: () => controller.closeApplet(manifest.appId),
                  tooltip: 'Close',
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  style: IconButton.styleFrom(
                    minimumSize: const Size(24, 24),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ),
                const SizedBox(width: 12),
                // Minimize Button
                IconButton(
                  icon: Icon(Icons.remove, size: 18, color: tokens.textSecondary),
                  onPressed: () => controller.minimizeApplet(),
                  tooltip: 'Minimize',
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  style: IconButton.styleFrom(
                    minimumSize: const Size(24, 24),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ),
                const SizedBox(width: 16),
                // Applet Title
                Text(
                  manifest.name,
                  style: TextStyle(
                    color: tokens.textPrimary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const Spacer(),
                Icon(Icons.more_horiz, color: tokens.textSecondary, size: 20),
              ],
            ),
          ),
          // Applet Content
          Expanded(
            child: AppletContainer(
              key: ValueKey(manifest.appId),
              manifest: manifest,
              bundleUrl: mockUrl,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRightPanelWrapper(BuildContext context, ShellController controller, ThemeData theme, double height) {
    final bool collapsed = controller.isRightPanelCollapsed.value;
    
    double effectiveWidth;
    if (collapsed) {
      effectiveWidth = UIKit.rightPanelCollapsedWidth;
    } else if (controller.rightPanelWidthMode.value == RightPanelWidthMode.adaptive) {
      final viewportWidth = MediaQuery.of(context).size.width;
      effectiveWidth = (viewportWidth * 0.618).clamp(UIKit.rightPanelMinWidth, 800.0);
    } else {
      effectiveWidth = controller.rightPanelWidth.value;
    }

    final double totalWidth = effectiveWidth + UIKit.splitHandleWidth;
    return SizedBox(
      width: totalWidth,
      height: height,
      child: Row(
        mainAxisSize: MainAxisSize.max,
        children: [
          MouseRegion(
            cursor: SystemMouseCursors.resizeColumn,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onPanUpdate: (details) {
                if (controller.isRightPanelCollapsed.value) {
                  controller.expandRightPanel();
                }
                // 用户手动调整大小时，切换为固定宽度模式
                if (controller.rightPanelWidthMode.value != RightPanelWidthMode.fixed) {
                  controller.rightPanelWidthMode.value = RightPanelWidthMode.fixed;
                  // 初始值设为当前视觉宽度
                  controller.rightPanelWidth.value = (MediaQuery.of(context).size.width * 0.618)
                      .clamp(UIKit.rightPanelMinWidth, MediaQuery.of(context).size.width * 0.618);
                }

                // 计算最大宽度：窗口宽度的 61.8%
                final viewportWidth = MediaQuery.of(context).size.width;
                final maxWidth = viewportWidth * 0.618;
                
                final next = (controller.rightPanelWidth.value - details.delta.dx)
                    .clamp(UIKit.rightPanelMinWidth, maxWidth);
                controller.rightPanelWidth.value = next.toDouble();
              },
              child: Container(
                width: UIKit.splitHandleWidth,
                color: Colors.transparent,
                child: Center(
                  child: Container(
                    width: 2,
                    height: 24,
                    color: UIKit.dividerColor(context),
                  ),
                ),
              ),
            ),
          ),
          _buildAssistantPanel(context, controller, theme),
        ],
      ),
    );
  }

  Widget _buildAssistantPanel(BuildContext context, ShellController controller, ThemeData theme) {
    final tokens = theme.extension<WeChatTokens>()!;
    final localizations = AppLocalizations.of(context);
    final builder = controller.rightPanelBuilder.value;
    final collapsed = controller.isRightPanelCollapsed.value;
    
    double panelWidth;
    if (collapsed) {
      panelWidth = UIKit.rightPanelCollapsedWidth;
    } else if (controller.rightPanelWidthMode.value == RightPanelWidthMode.adaptive) {
      // 自适应模式：使用 61.8% 的视口宽度，但受最小/最大宽度限制
      // 注意：这里为了满足“内容完整显示”的需求，我们不强制使用 UIKit.rightPanelMaxWidth
      final viewportWidth = MediaQuery.of(context).size.width;
      panelWidth = (viewportWidth * 0.618).clamp(UIKit.rightPanelMinWidth, 800.0);
    } else {
      panelWidth = controller.rightPanelWidth.value;
    }
    
    // 展开态时检查有效宽度，折叠态下由常量宽度保证
    if (!collapsed && panelWidth <= 0) {
      return const SizedBox.shrink();
    }
    
    return Container(
      width: panelWidth, // 折叠/展开态的固定宽度
      decoration: BoxDecoration(
        color: tokens.bgLevel1, // 辅助面板背景色
        // 取消阴影，靠区域底色区分
      ),
      child: Column(
        mainAxisSize: MainAxisSize.max,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
            // 顶部控制区 - 固定64px，显式尺寸包装避免未布局
            Obx(() {
              final showCollapse = controller.showRightPanelCollapseButton.value;
              final isCollapsed = controller.isRightPanelCollapsed.value;
              return SizedBox(
                height: UIKit.topBarHeight,
                child: ColoredBox(
                  color: tokens.bgLevel2,
                  child: LayoutBuilder(
                    builder: (ctx, c) {
                      final isNarrow = c.maxWidth.isFinite && c.maxWidth < 80;
                      final useCollapsedLayout = isCollapsed || isNarrow;
                      return Padding(
                        padding: EdgeInsets.symmetric(horizontal: UIKit.spaceSm(context)),
                        child: useCollapsedLayout
                            // 窄宽或折叠态：仅居中显示小号按钮
                            ? Center(
                                child: Tooltip(
                                  message: localizations?.expand ?? 'Expand',
                                  child: IconButton(
                                    padding: EdgeInsets.zero,
                                    iconSize: 18,
                                    icon: const Icon(Icons.keyboard_double_arrow_left),
                                    onPressed: () => controller.toggleCollapseRightPanel(),
                                  ),
                                ),
                              )
                            // 展开态且宽度充裕：右上角显示折叠按钮
                            : Row(
                                children: [
                                  const Spacer(),
                                  if (showCollapse)
                                    Tooltip(
                                      message: localizations?.collapse ?? 'Collapse',
                                      child: IconButton(
                                        style: UIKit.squareIconButtonStyle(context),
                                        icon: const Icon(Icons.keyboard_double_arrow_right),
                                        onPressed: () => controller.toggleCollapseRightPanel(),
                                      ),
                                    ),
                                ],
                              ),
                      );
                    },
                  ),
                ),
              );
            }),
          // 内容区域 - 自适应高度
          Expanded(
            child: Container(
              color: tokens.bgLevel1,
              child: (!collapsed && builder != null)
                  ? _buildRightPanelScrollable(context, builder, controller)
                  : const SizedBox.shrink(),
            ),
          ),
        ],
      ),
    );
  }

  /// 直接构建内容，不做额外的滚动封装，让业务页面自己决定布局
  Widget _buildRightPanelScrollable(
      BuildContext context, WidgetBuilder builder, ShellController controller) {
    // 直接返回构建的内容，移除强制的 Padding 和 ScrollView
    // 这样子组件（如 DiscoveryDetailView）可以直接获取到 Panel 的准确约束
    // 从而正确执行 Center、Expanded 等布局逻辑
    // 
    // 2024-05: 增加全局统一的水平间距 (UIKit.spaceXl = 24)
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: UIKit.spaceXl(context)),
      child: Builder(builder: builder),
    );
  }

  void _handleGlobalTap(BuildContext context, ShellController controller, PointerDownEvent event) {
    // 仅处理：可见 + 展开 + 覆盖模式
    if (!controller.isRightPanelVisible.value || 
        controller.isRightPanelCollapsed.value || 
        controller.rightPanelMode.value != RightPanelMode.cover) {
      return;
    }

    // 计算右侧面板的区域
    final screenWidth = MediaQuery.of(context).size.width;
    
    // 计算面板当前宽度
    double panelWidth;
    if (controller.rightPanelWidthMode.value == RightPanelWidthMode.adaptive) {
      panelWidth = (screenWidth * 0.618).clamp(UIKit.rightPanelMinWidth, 800.0);
    } else {
      panelWidth = controller.rightPanelWidth.value;
    }
    
    // 加上拖拽条宽度（Positioned 的 child 是 _buildRightPanelWrapper，包含 SplitHandle）
    final totalWidth = panelWidth + UIKit.splitHandleWidth;
    
    // 面板左边界
    final panelLeft = screenWidth - totalWidth;

    // 如果点击位置在面板左侧，则收起
    if (event.position.dx < panelLeft) {
      controller.collapseRightPanel();
    }
  }
}