import 'dart:io';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/constants/app_constants.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/theme/app_theme.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';

class ShellPage extends StatelessWidget {
  const ShellPage({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = theme.extension<WeChatTokens>()!;
    final localizations = AppLocalizations.of(context);

    return GetBuilder<ShellController>(
      builder: (controller) {
        return Scaffold(
          backgroundColor: tokens.bgLevel0,
          body: Padding(
            padding: EdgeInsets.only(
              top: Platform.isMacOS ? AppConstants.macOSTitleBarHeight : 0,
            ),
            child: Row(
              children: [
                // 一级菜单栏 - 固定64px
                _buildPrimaryMenuBar(context, controller, theme),
                // 主内容区 - 自适应
                Expanded(
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      // 响应式断点处理
                      if (constraints.maxWidth > 1200) {
                        // 超宽屏幕居中显示
                        return Center(
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 1200),
                            child: _buildContentArea(context, controller, theme, localizations),
                          ),
                        );
                      } else {
                        return _buildContentArea(context, controller, theme, localizations);
                      }
                    },
                  ),
                ),
                // 辅助面板 - overlay模式
                Obx(() {
                  if (controller.isRightPanelVisible.value) {
                    return _buildAssistantPanel(context, controller, theme);
                  } else {
                    return const SizedBox.shrink();
                  }
                }),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildPrimaryMenuBar(BuildContext context, ShellController controller, ThemeData theme) {
    final tokens = theme.extension<WeChatTokens>()!;
    return Container(
      width: 64, // 一级菜单栏固定宽度
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
    );
  }

  Widget _buildAvatarBlock(BuildContext context, ShellController controller, ThemeData theme) {
    final tokens = theme.extension<WeChatTokens>()!;
    final avatarBuilder = PrimaryMenuManager.getAvatarBlockBuilder();
    
    return Container(
      height: 80, // 固定高度
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
      height: 80, // 固定高度
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
    return Container(
      height: 56, // 菜单图标固定高度
      margin: EdgeInsets.symmetric(vertical: tokens.spaceXs, horizontal: tokens.spaceXs),
      decoration: BoxDecoration(
        color: isSelected ? tokens.menuSelected : Colors.transparent,
        borderRadius: BorderRadius.circular(tokens.radiusMd),
      ),
      child: IconButton(
        icon: Icon(item.icon, color: tokens.textPrimary, size: 24),
        onPressed: () => controller.selectMenuItem(item),
        tooltip: item.label,
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
          : Container(
              color: tokens.bgLevel1,
              child: Center(
                child: Text(
                  localizations?.selectFunction ?? '请选择功能',
                  style: TextStyle(color: tokens.textPrimary),
                ),
              ),
            ),
    );
  }

  Widget _buildAssistantPanel(BuildContext context, ShellController controller, ThemeData theme) {
    final tokens = theme.extension<WeChatTokens>()!;
    return Container(
      width: 320, // 辅助面板固定宽度
      decoration: BoxDecoration(
        color: tokens.bgLevel1, // 辅助面板背景色
        boxShadow: [
          BoxShadow(
            color: Color.fromRGBO(0, 0, 0, 0.3),
            blurRadius: 8,
            offset: const Offset(-2, 0),
          ),
        ],
      ),
      child: Column(
        children: [
          // 顶部控制区 - 固定64px
          Container(
            height: 64,
            color: tokens.bgLevel2, // 顶部控制区背景色
          ),
          // 内容区域 - 自适应高度
          Expanded(
            child: Container(
              color: tokens.bgLevel1, // 内容区域背景色
            ),
          ),
        ],
      ),
    );
  }
}