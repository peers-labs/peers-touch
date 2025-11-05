import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

class WindowSizeConfig {
  // 基础窗口大小配置
  static Size getMinimumSize() {
    if (kIsWeb) {
      return const Size(800, 600);
    }
    
    if (Platform.isMacOS) {
      // macOS 通常有更好的屏幕，可以支持更紧凑的布局
      return const Size(900, 650);
    } else if (Platform.isWindows) {
      // Windows 用户习惯更大的窗口
      return const Size(1000, 700);
    } else if (Platform.isLinux) {
      // Linux 用户通常更注重效率，适中的大小
      return const Size(950, 680);
    }
    
    // 默认大小
    return const Size(1000, 700);
  }
  
  static Size getDefaultSize() {
    if (kIsWeb) {
      return const Size(1200, 800);
    }
    
    if (Platform.isMacOS) {
      return const Size(1100, 750);
    } else if (Platform.isWindows) {
      return const Size(1280, 800);
    } else if (Platform.isLinux) {
      return const Size(1150, 780);
    }
    
    return const Size(1200, 800);
  }
  
  static Size getMaximumSize() {
    if (kIsWeb) {
      return const Size(1920, 1080);
    }
    
    if (Platform.isMacOS) {
      return const Size(1600, 1000);
    } else if (Platform.isWindows) {
      return const Size(1920, 1080);
    } else if (Platform.isLinux) {
      return const Size(1600, 1000);
    }
    
    return const Size(1920, 1080);
  }
  
  // 根据屏幕尺寸动态调整
  static Size getOptimalSize(double screenWidth, double screenHeight) {
    // 如果屏幕很小（< 1366x768），使用最小尺寸
    if (screenWidth < 1366 || screenHeight < 768) {
      return getMinimumSize();
    }
    
    // 如果屏幕很大（> 1920x1080），使用较大尺寸
    if (screenWidth > 1920 && screenHeight > 1080) {
      return getDefaultSize();
    }
    
    // 中等屏幕，使用适中的默认尺寸
    return getDefaultSize();
  }
}