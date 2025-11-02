import 'package:desktop/pages/ai/ai_chat_page.dart';
import 'package:desktop/pages/ai/chat_list.dart';
import 'package:desktop/pages/settings/settings_page.dart';
import 'package:desktop/pages/settings/settings_main_page.dart';
import 'package:desktop/pages/settings/ai_service_provider_page.dart';
import 'package:desktop/providers/model_provider.dart';
import 'package:desktop/providers/ai_provider_state_interface.dart';
import 'package:desktop/providers/mock_ai_provider_state.dart';
import 'package:desktop/providers/right_sidebar_provider.dart';
import 'package:desktop/providers/sidebar_state_provider.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';
import 'services/backend_client.dart';
import 'pages/peers_center.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Must add this line.
  await windowManager.ensureInitialized();

  WindowOptions windowOptions = const WindowOptions(
    minimumSize: Size(1000, 750),
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
        ChangeNotifierProvider(create: (_) => AIModelProvider()),
        ChangeNotifierProvider(create: (_) => RightSidebarProvider()),
        ChangeNotifierProvider(create: (_) => SidebarStateProvider()),
        // Use mock provider state for testing dynamic config fields
        ChangeNotifierProvider<AIProviderStateInterface>(create: (_) => MockAIProviderState()),
      ],
      child: MaterialApp(
        title: 'Peers Touch Station',
        theme: ThemeData(
          primarySwatch: Colors.blue,
          fontFamily: 'Segoe UI',
        ),
        home: const HomeScreen(),
        routes: {
          '/settings': (context) => const SettingsPage(),
          '/ai-service-provider': (context) => const AiServiceProviderPage(),
        },
        debugShowCheckedModeBanner: false,
      ),
    );
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
  void initState() {
    super.initState();
  }

  @override
  Widget build(BuildContext context) {
    final sidebarState = Provider.of<SidebarStateProvider>(context);

    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FA),
      body: Row(
        children: [
          // Conditional Sidebar
          if (sidebarState.isLeftSidebarOpen)
            _buildFullSidebar(context)
          else
            _buildMiniSidebar(context),

          // Main Content Area
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(0, 32, 32, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header
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
                          icon: Icon(sidebarState.isMiddleColumnOpen ? Icons.keyboard_arrow_left : Icons.keyboard_arrow_right),
                          onPressed: () => sidebarState.toggleMiddleColumn(),
                          tooltip: sidebarState.isMiddleColumnOpen ? 'Hide Chat List' : 'Show Chat List',
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
                      // Settings Button
                      IconButton(
                        icon: const Icon(Icons.settings, size: 24),
                        onPressed: () {
                          setState(() => selectedIndex = 5);
                        },
                        tooltip: 'Settings',
                      ),
                    ],
                  ),
                  const SizedBox(height: 32),
                  // Content Switcher
                  Expanded(
                    child: _buildMainContent(),
                  ),
                ],
              ),
            ),
          ),

          // Right Sidebar (conditionally shown)
          if (selectedIndex != 4)
            Container(
              width: 300,
              decoration: const BoxDecoration(
                border: Border(
                  left: BorderSide(color: Color(0xFFE0E0E0)),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Tasks',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 16),
                    _buildTaskItem('Review Q3 budget', 'You', true),
                    _buildTaskItem('Finalize presentation deck', 'Alex', false),
                    _buildTaskItem('Onboarding new hire', 'You', false),
                    const SizedBox(height: 32),
                    const Text(
                      'Recent',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 16),
                    _buildRecentItem(
                      icon: Icons.description,
                      name: 'Project Phoenix Spec',
                      type: 'Paper',
                      color: Colors.blue,
                    ),
                    _buildRecentItem(
                      icon: Icons.folder,
                      name: 'Marketing Assets Q4',
                      type: 'Folder',
                      color: Colors.orange,
                    ),
                  ],
                ),
              ),
            ),
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

  Widget _buildFullSidebar(BuildContext context) {
    final sidebarState = Provider.of<SidebarStateProvider>(context, listen: false);
    return Container(
      width: 240,
      decoration: const BoxDecoration(
        color: Color(0xFF2B3A67),
        borderRadius: BorderRadius.only(
          topRight: Radius.circular(20),
          bottomRight: Radius.circular(20),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 32, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Nav Items
            _buildNavItem(
              icon: Icons.home_outlined,
              label: 'Home',
              isSelected: selectedIndex == 0,
              onTap: () => setState(() => selectedIndex = 0),
            ),
            _buildNavItem(
              icon: Icons.folder_outlined,
              label: 'Files',
              isSelected: selectedIndex == 1,
              onTap: () => setState(() => selectedIndex = 1),
            ),
            _buildNavItem(
              icon: Icons.description_outlined,
              label: 'Paper',
              isSelected: selectedIndex == 2,
              onTap: () => setState(() => selectedIndex = 2),
            ),
            _buildNavItem(
              icon: Icons.people_alt_outlined,
              label: 'Peers-Center',
              isSelected: selectedIndex == 3,
              onTap: () => setState(() => selectedIndex = 3),
            ),
            _buildNavItem(
              icon: Icons.smart_toy_outlined,
              label: 'AI Chat',
              isSelected: selectedIndex == 4,
              onTap: () => setState(() => selectedIndex = 4),
            ),
            const Divider(color: Colors.white24, height: 32, indent: 8, endIndent: 8),

            const Spacer(), // Pushes the settings and collapse buttons to the bottom

            // Settings Button
            _buildNavItem(
              icon: Icons.settings_outlined,
              label: 'Settings',
              isSelected: selectedIndex == 5,
              onTap: () => setState(() => selectedIndex = 5),
            ),

             _buildNavItem(
               icon: Icons.menu_open,
               label: 'Collapse',
               isSelected: false,
               onTap: () => sidebarState.toggleLeftSidebar(),
             ),
          ],
        ),
      ),
    );
  }

  Widget _buildMiniSidebar(BuildContext context) {
    final sidebarState = Provider.of<SidebarStateProvider>(context, listen: false);
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

            // Expand Button
            IconButton(
              icon: const Icon(Icons.menu, color: Colors.white70),
              onPressed: () => sidebarState.toggleLeftSidebar(),
              tooltip: 'Expand Sidebar',
            ),
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
          color: isSelected ? Colors.white.withOpacity(0.1) : Colors.transparent,
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

  Widget _buildNavItem({
    required IconData icon,
    required String label,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(
          icon,
          color: isSelected ? Colors.white : Colors.white70,
          size: 20,
        ),
        title: Text(
          label,
          style: TextStyle(
            color: isSelected ? Colors.white : Colors.white70,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
          ),
        ),
        selected: isSelected,
        selectedTileColor: Colors.white.withOpacity(0.1),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
        ),
        onTap: onTap,
      ),
    );
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
            color: Colors.black.withOpacity(0.05),
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
              color: color.withOpacity(0.1),
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
