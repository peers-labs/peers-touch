import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';
import 'dart:io' show Platform;

/// 窗口选项管理器 - 负责根据操作系统提供合适的窗口配置
class WindowOptionsManager {
  /// 根据操作系统获取对应的窗口选项
  static WindowOptions getWindowOptionsForPlatform() {
    if (Platform.isMacOS) {
      return _getMacOSWindowOptions();
    } else if (Platform.isWindows) {
      return _getWindowsWindowOptions();
    } else if (Platform.isLinux) {
      return _getLinuxWindowOptions();
    } else {
      return _getDefaultWindowOptions();
    }
  }

  /// macOS窗口选项
  static WindowOptions _getMacOSWindowOptions() {
    return WindowOptions(
      minimumSize: const Size(1024, 768), // 最小宽度1024px，最小高度768px
      size: const Size(1440, 900),        // 初始窗口大小
      center: true,                        // 窗口居中
      titleBarStyle: TitleBarStyle.hidden, // 隐藏标题栏（macOS风格）
    );
  }

  /// Windows窗口选项
  static WindowOptions _getWindowsWindowOptions() {
    return WindowOptions(
      minimumSize: const Size(960, 720),   // 最小宽度960px，最小高度720px
      size: const Size(1280, 800),         // 初始窗口大小
      center: true,                        // 窗口居中
      titleBarStyle: TitleBarStyle.normal, // 正常标题栏（Windows风格）
    );
  }

  /// Linux窗口选项
  static WindowOptions _getLinuxWindowOptions() {
    return WindowOptions(
      minimumSize: const Size(960, 720),   // 最小宽度960px，最小高度720px
      size: const Size(1280, 800),         // 初始窗口大小
      center: true,                        // 窗口居中
      titleBarStyle: TitleBarStyle.normal, // 正常标题栏（Linux风格）
    );
  }

  /// 默认窗口选项（其他平台）
  static WindowOptions _getDefaultWindowOptions() {
    return WindowOptions(
      minimumSize: const Size(800, 600),   // 最小宽度800px，最小高度600px
      size: const Size(1200, 800),         // 初始窗口大小
      center: true,                        // 窗口居中
      titleBarStyle: TitleBarStyle.normal, // 正常标题栏
    );
  }

  /// 初始化窗口管理器
  static Future<void> initializeWindowManager() async {
    await windowManager.ensureInitialized();
    
    final windowOptions = getWindowOptionsForPlatform();
    
    // 等待窗口准备好后显示
    windowManager.waitUntilReadyToShow(windowOptions, () async {
      await windowManager.show();
      await windowManager.focus();
    });
  }
}