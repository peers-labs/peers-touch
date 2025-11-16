import 'package:flutter/foundation.dart';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/constants/app_constants.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/theme/app_theme.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

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
          body: RawKeyboardListener(
            focusNode: FocusNode(),
            autofocus: true,
            onKey: controller.handleKeyEvent,
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
                      // 主内容区 - 自适应
                      Expanded(
                        child: LayoutBuilder(
                          builder: (context, constraints) {
                            return _buildContentArea(context, controller, theme, localizations);
                          },
                        ),
                      ),
                      // 右侧辅助面板：受父高度约束
                      Obx(() {
                        if (!controller.isRightPanelVisible.value) {
                          return const SizedBox.shrink();
                        }
                        final bool collapsed = controller.isRightPanelCollapsed.value;
                        final double effectiveWidth = collapsed
                            ? UIKit.rightPanelCollapsedWidth
                            : controller.rightPanelWidth.value;
                        final double totalWidth = effectiveWidth + UIKit.splitHandleWidth;
                        return SizedBox(
                          width: totalWidth,
                          height: viewportH,
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
                                    final next = (controller.rightPanelWidth.value - details.delta.dx)
                                        .clamp(UIKit.rightPanelMinWidth, UIKit.rightPanelMaxWidth);
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
                      }),
                    ],
                  );
                },
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
          Expanded(
            child: _buildHeadMenuArea(context, controller, theme),
          ),
          
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
      child: Column(
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
    return Tooltip(
      message: item.label,
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
    final currentItem = controller.currentMenuItem.value;
    
    return Container(
      color: tokens.bgLevel1,
      child: currentItem != null
          ? Builder(builder: currentItem.contentBuilder) // 显示选中的模块内容
          : Container(color: tokens.bgLevel1), // 中心区留白
    );
  }

  Widget _buildAssistantPanel(BuildContext context, ShellController controller, ThemeData theme) {
    final tokens = theme.extension<WeChatTokens>()!;
    final builder = controller.rightPanelBuilder.value;
    final collapsed = controller.isRightPanelCollapsed.value;
    final panelWidth = collapsed ? UIKit.rightPanelCollapsedWidth : controller.rightPanelWidth.value;
    
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
                                  message: '展开',
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
                                      message: '折叠',
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

  /// 右侧面板内容采用轴感知滚动封装：
  /// - 若子内容不是竖向滚动视图，则外层提供竖向滚动与最小高度约束；
  /// - 若子内容不是横向滚动视图，则外层提供按需横向滚动与宽度上限（黄金分割）。
  Widget _buildRightPanelScrollable(
      BuildContext context, WidgetBuilder builder, ShellController controller) {
    return LayoutBuilder(
      builder: (ctx, constraints) {
        final viewportW = constraints.maxWidth.isFinite
            ? constraints.maxWidth
            : MediaQuery.of(ctx).size.width;
        final viewportH = constraints.maxHeight.isFinite
            ? constraints.maxHeight
            : MediaQuery.of(ctx).size.height;
        const double goldenMaxRatio = 0.618; // 额外横向空间上限比例

        Widget child = Builder(builder: builder);
        Axis? childAxis;
        if (child is ScrollView) {
          childAxis = child.scrollDirection;
        }

        // 竖向封装移除：避免为未知子内容提供 SingleChildScrollView 导致不受约束的高度
        // 统一仅应用内边距，竖向滚动由各子内容自己管理
        Widget content = Padding(padding: EdgeInsets.all(UIKit.spaceMd(context)), child: child);

        // 横向封装：若子内容不是横向滚动视图，则提供外层横向滚动与宽度上限
        if (childAxis != Axis.horizontal) {
          final hController = ScrollController();
          Widget horizontal = SingleChildScrollView(
            controller: hController,
            scrollDirection: Axis.horizontal,
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minWidth: viewportW,
                maxWidth: viewportW + viewportW * goldenMaxRatio,
              ),
              child: content,
            ),
          );
          content = ScrollConfiguration(
            behavior: const _NoGlowScrollBehavior(),
            child: Scrollbar(controller: hController, thumbVisibility: false, child: horizontal),
          );
        }

        return content;
      },
    );
  }

}

class _NoGlowScrollBehavior extends ScrollBehavior {
  const _NoGlowScrollBehavior();
  @override
  Widget buildViewportChrome(BuildContext context, Widget child, AxisDirection axisDirection) {
    return child;
  }
}