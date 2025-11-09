import 'package:flutter/material.dart';

/// 一级菜单项定义
class PrimaryMenuItem {
  final String id;
  final String label;
  final IconData icon;
  final bool isHead; // true=头部区域，false=尾部区域
  final int order; // 区域内的排序权重
  final WidgetBuilder contentBuilder; // 完整的模块内容页面构建器
  final bool toDIsplayPageTitle; // 二级页是否显示功能标题（默认不显示）

  const PrimaryMenuItem({
    required this.id,
    required this.label,
    required this.icon,
    required this.isHead,
    required this.order,
    required this.contentBuilder,
    this.toDIsplayPageTitle = false,
  });
}

/// 一级菜单管理器 - 负责管理头像块、头部区域、尾部区域
class PrimaryMenuManager {
  // 头像块区域 - 固定内容，由系统统一管理
  static WidgetBuilder? _avatarBlockBuilder;
  
  // 头部区域菜单 - 业务功能
  static final List<PrimaryMenuItem> _headItems = [];
  
  // 尾部区域菜单 - 重要入口
  static final List<PrimaryMenuItem> _tailItems = [];

  /// 设置头像块构建器
  static void setAvatarBlockBuilder(WidgetBuilder builder) {
    _avatarBlockBuilder = builder;
  }

  /// 注册菜单项
  static void registerItem(PrimaryMenuItem item) {
    if (item.isHead) {
      _headItems.add(item);
      _headItems.sort((a, b) => a.order.compareTo(b.order));
    } else {
      _tailItems.add(item);
      _tailItems.sort((a, b) => a.order.compareTo(b.order));
    }
  }

  /// 获取头像块构建器
  static WidgetBuilder? getAvatarBlockBuilder() {
    return _avatarBlockBuilder;
  }

  /// 获取头部区域菜单列表
  static List<PrimaryMenuItem> getHeadList() {
    return List.from(_headItems);
  }

  /// 获取尾部区域菜单列表
  static List<PrimaryMenuItem> getTailList() {
    return List.from(_tailItems);
  }

  /// 根据ID查找菜单项
  static PrimaryMenuItem? getItemById(String id) {
    final headItem = _headItems.firstWhere((item) => item.id == id, orElse: () => _tailItems.firstWhere((item) => item.id == id, orElse: () => _createDummyItem()));
    return headItem.id == 'dummy' ? null : headItem;
  }

  /// 创建虚拟菜单项用于查找
  static PrimaryMenuItem _createDummyItem() {
    return const PrimaryMenuItem(
      id: 'dummy',
      label: '',
      icon: Icons.error,
      isHead: true,
      order: 0,
      contentBuilder: _dummyBuilder,
      toDIsplayPageTitle: false,
    );
  }

  /// 虚拟构建器
  static Widget _dummyBuilder(BuildContext context) {
    return Container();
  }

  /// 清空所有注册项（主要用于测试）
  static void clearAll() {
    _avatarBlockBuilder = null;
    _headItems.clear();
    _tailItems.clear();
  }
}