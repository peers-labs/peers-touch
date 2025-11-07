import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:window_manager/window_manager.dart';

/// Window options manager - responsible for providing appropriate window configuration based on operating system
class WindowOptionsManager {
  /// Get corresponding window options based on operating system
  static WindowOptions getWindowOptions() {
    switch (defaultTargetPlatform) {
      case TargetPlatform.macOS:
        return _getMacOSOptions();
      case TargetPlatform.windows:
        return _getWindowsOptions();
      case TargetPlatform.linux:
        return _getLinuxOptions();
      default:
        return _getDefaultOptions();
    }
  }

  /// macOS window options
  static WindowOptions _getMacOSOptions() {
    return const WindowOptions(
      minimumSize: Size(1024, 768), // Minimum width 1024px, minimum height 768px
      size: Size(1440, 900),        // Initial window size
      center: true,                        // Center window
      titleBarStyle: TitleBarStyle.hidden, // Hidden title bar (macOS style)
    );
  }

  /// Windows window options
  static WindowOptions _getWindowsOptions() {
    return const WindowOptions(
      minimumSize: Size(960, 720),   // Minimum width 960px, minimum height 720px
      size: Size(1280, 800),         // Initial window size
      center: true,                        // Center window
      titleBarStyle: TitleBarStyle.normal, // Normal title bar (Windows style)
    );
  }

  /// Linux window options
  static WindowOptions _getLinuxOptions() {
    return const WindowOptions(
      minimumSize: Size(960, 720),   // Minimum width 960px, minimum height 720px
      size: Size(1280, 800),         // Initial window size
      center: true,                        // Center window
      titleBarStyle: TitleBarStyle.normal, // Normal title bar (Linux style)
    );
  }

  /// Default window options (other platforms)
  static WindowOptions _getDefaultOptions() {
    return const WindowOptions(
      minimumSize: Size(800, 600),   // Minimum width 800px, minimum height 600px
      size: Size(1200, 800),         // Initial window size
      center: true,                        // Center window
      titleBarStyle: TitleBarStyle.normal, // Normal title bar
    );
  }

  /// Initialize window manager
  static Future<void> initializeWindowManager() async {
    final windowOptions = getWindowOptions();
    await windowManager.ensureInitialized();
    await windowManager.waitUntilReadyToShow(windowOptions, () async {
      await windowManager.show();
      await windowManager.focus();
    });
  }
}