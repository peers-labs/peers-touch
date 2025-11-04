import 'package:desktop/page/ai/ai_chat_page.dart';
import 'package:desktop/page/peers_center.dart';
import 'package:desktop/page/settings/settings_page.dart';
import 'package:desktop/page/settings/settings_main_page.dart';
import 'package:desktop/page/settings/ai_service_provider_page.dart';
import 'package:desktop/provider/model_provider.dart';
import 'package:desktop/provider/right_sidebar_provider.dart';
import 'package:desktop/provider/sidebar_state_provider.dart';
import 'package:desktop/provider/locale_provider.dart';
import 'package:desktop/controller/ai_provider_controller.dart';
import 'package:desktop/service/backend_client.dart';
import 'package:desktop/service/logging_service.dart';
import 'package:desktop/core/network/network.dart';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';
import 'config/window_size_config.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await setupLogging();
  
  // Initialize global network client
  NetworkProvider.initialize(
    baseUrl: 'http://localhost:8080',
    enableLogging: true,
    loggingConfig: const LoggingInterceptorConfig(
      logHeaders: true,
      logBody: true,
      logDuration: true,
      maxBodyLength: 1000,
    ),
  );
  
  // Must add this line.
  await windowManager.ensureInitialized();

  // Get screen size
  final screenSize = MediaQueryData.fromView(WidgetsBinding.instance.platformDispatcher.implicitView!);
  final optimalSize = WindowSizeConfig.getOptimalSize(
    screenSize.size.width,
    screenSize.size.height,
  );

  WindowOptions windowOptions = WindowOptions(
    size: optimalSize,
    minimumSize: WindowSizeConfig.getMinimumSize(),
    maximumSize: WindowSizeConfig.getMaximumSize(),
    center: true,
    backgroundColor: Colors.transparent,
    skipTaskbar: false,
    titleBarStyle: TitleBarStyle.normal,
  );

  windowManager.waitUntilReadyToShow(windowOptions, () async {
    await windowManager.show();
    await windowManager.focus();
  });

  runApp(const PeersTouchStationApp());
}

class PeersTouchStationApp extends StatelessWidget {
  const PeersTouchStationApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AIModelProvider>(create: (_) => AIModelProvider()),
        ChangeNotifierProvider<RightSidebarProvider>(create: (_) => RightSidebarProvider()),
        ChangeNotifierProvider<SidebarStateProvider>(create: (_) => SidebarStateProvider()),
        ChangeNotifierProvider<LocaleProvider>(
          create: (_) => LocaleProvider()..setLocale(const Locale('en')),
        ),
      ],
      child: GetMaterialApp(
        title: 'Peers Touch Station',
        theme: ThemeData(
          primarySwatch: Colors.blue,
          fontFamily: 'Segoe UI',
        ),
        initialBinding: AppBindings(),
        home: const HomeScreen(),
        getPages: [
          GetPage(name: '/settings', page: () => const SettingsPage()),
          GetPage(name: '/ai-service-provider', page: () => const AiServiceProviderPage()),
        ],
        debugShowCheckedModeBanner: false,
      ),
    );
  }
}

class AppBindings implements Bindings {
  @override
  void dependencies() {
    // 初始化控制器
    Get.put(AIProviderController(), permanent: true);
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int selectedIndex = 0;
  final BackendClient _backend = BackendClient();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FA),
      body: Row(
        children: [
          _buildMiniSidebar(context),

          // Main Content Area
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(0, 32, 32, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header
                  if (selectedIndex != 5) ...[
                    Row(
                      children: [
                        // Page Title
                        Expanded(
                          child: Text(
                            _titleForIndex(selectedIndex),
                            style: const TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.bold,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 16),
                        // Middle column toggle (only for AI Chat page)
                        if (selectedIndex == 4)
                          IconButton(
                            icon: const Icon(Icons.keyboard_arrow_left),
                            onPressed: () {},
                            tooltip: 'Hide Chat List',
                          ),
                        // Search Bar - 使用LayoutBuilder根据可用空间决定是否显示
                        LayoutBuilder(
                          builder: (context, constraints) {
                            // 只有当可用宽度大于400px时才显示搜索框
                            if (constraints.maxWidth > 400) {
                              return Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Container(
                                    width: 200,
                                    height: 36,
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFF1F3F4),
                                      borderRadius: BorderRadius.circular(18),
                                    ),
                                    child: const TextField(
                                      decoration: InputDecoration(
                                        hintText: 'Search',
                                        prefixIcon: Icon(Icons.search, color: Colors.grey, size: 18),
                                        border: InputBorder.none,
                                        contentPadding: EdgeInsets.symmetric(vertical: 8),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 16),
                                ],
                              );
                            }
                            return const SizedBox.shrink();
                          },
                        ),
                        // Removed settings shortcut button per requirement
                      ],
                    ),
                    const SizedBox(height: 32),
                  ],
                  // Content Switcher
                  Expanded(
                    child: _buildMainContent(),
                  ),
                ],
              ),
            ),
          ),

          // Removed right sidebar per requirement
        ],
      ),
    );
  }

  Widget _buildMainContent() {
    switch (selectedIndex) {
      case 3:
        return PeersCenterPage(backend: _backend);
      case 4:
        return const AIChatPage();
      case 5:
        return const SettingsMainPage();
      default:
        return Center(
          child: Text('Content for ${_titleForIndex(selectedIndex)}'),
        );
    }
  }

  Widget _buildMiniSidebar(BuildContext context) {
    return Container(
      width: 72,
      decoration: const BoxDecoration(
        color: Color(0xFF2B3A67),
        borderRadius: BorderRadius.only(
          topRight: Radius.circular(20),
          bottomRight: Radius.circular(20),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 32, 8, 16),
        child: Column(
          children: [
            // Nav Icons
            _buildMiniIcon(Icons.home_outlined, 'Home', 0),
            _buildMiniIcon(Icons.folder_outlined, 'Files', 1),
            _buildMiniIcon(Icons.description_outlined, 'Paper', 2),
            _buildMiniIcon(Icons.people_alt_outlined, 'Peers-Center', 3),
            _buildMiniIcon(Icons.smart_toy_outlined, 'AI Chat', 4),

            const Spacer(),

            // Settings Icon
            _buildMiniIcon(Icons.settings_outlined, 'Settings', 5),
          ],
        ),
      ),
    );
  }

  Widget _buildMiniIcon(IconData icon, String tooltip, int index) {
    final isSelected = selectedIndex == index;
    return Tooltip(
      message: tooltip,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        height: 48,
        width: 56,
        decoration: BoxDecoration(
          color: isSelected ? Colors.white.withValues(alpha: 0.1) : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () => setState(() => selectedIndex = index),
            borderRadius: BorderRadius.circular(8),
            child: Icon(icon, color: isSelected ? Colors.white : Colors.white70, size: 20),
          ),
        ),
      ),
    );
  }

  String _titleForIndex(int i) {
    switch (i) {
      case 0:
        return 'Home';
      case 1:
        return 'Files';
      case 2:
        return 'Paper';
      case 3:
        return 'Peers-Center';
      case 4:
        return 'AI Chat';
      case 5:
        return 'Settings';
      default:
        return 'Peers Touch';
    }
  }

  Widget _buildTaskItem(String task, String assignee, bool isCompleted) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(
            isCompleted ? Icons.check_circle : Icons.radio_button_unchecked,
            color: isCompleted ? Colors.green : Colors.grey,
            size: 14, // 减小图标尺寸
          ),
          const SizedBox(width: 6), // 减小间距
          Expanded(
            child: Text(
              task,
              style: TextStyle(
                fontSize: 13, // 减小字体大小
                decoration: isCompleted ? TextDecoration.lineThrough : null,
              ),
              maxLines: 1, // 限制单行显示
              overflow: TextOverflow.ellipsis, // 过长时显示省略号
            ),
          ),
          const SizedBox(width: 4), // 减小间距
          Text(
            assignee,
            style: const TextStyle(
              fontSize: 11, // 减小字体大小
              color: Colors.blue,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRecentItem({
    required IconData icon,
    required String name,
    required String type,
    required Color color,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12), // 减小内边距
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 32, // 减小图标容器尺寸
            height: 32,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Icon(
              icon,
              color: color,
              size: 16, // 减小图标尺寸
            ),
          ),
          const SizedBox(width: 12), // 减小间距
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13, // 减小字体大小
                  ),
                  maxLines: 1, // 限制单行显示
                  overflow: TextOverflow.ellipsis, // 过长时显示省略号
                ),
                Text(
                  type,
                  style: const TextStyle(
                    color: Colors.grey,
                    fontSize: 11, // 减小字体大小
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}