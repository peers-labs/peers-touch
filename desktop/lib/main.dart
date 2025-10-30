import 'package:flutter/material.dart';
import 'services/backend_client.dart';
import 'pages/peers_center.dart';

void main() {
  runApp(const PeersTouchStationApp());
}

class PeersTouchStationApp extends StatelessWidget {
  const PeersTouchStationApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Peers Touch Station',
      theme: ThemeData(
        primarySwatch: Colors.blue,
        fontFamily: 'Segoe UI',
      ),
      home: const HomeScreen(),
      debugShowCheckedModeBanner: false,
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
    // Minimal backend check: fetch photo list and log result.
    _backend.listPhotos().then((data) {
      // Print basic info to console for verification without changing UI.
      final total = data['total'] ?? 'unknown';
      debugPrint('[StationDesktop] Backend reachable. total photos: $total');
    }).catchError((e) {
      debugPrint('[StationDesktop] Backend not reachable: $e');
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FA),
      body: Row(
        children: [
          // Sidebar
          Container(
            width: 220,
            decoration: const BoxDecoration(
              color: Color(0xFF2B3A67),
              borderRadius: BorderRadius.only(
                topRight: Radius.circular(20),
                bottomRight: Radius.circular(20),
              ),
            ),
            child: Column(
              children: [
                // Logo/Header
                Container(
                  padding: const EdgeInsets.all(24),
                  child: Row(
                    children: [
                      Container(
                        width: 32,
                        height: 32,
                        decoration: BoxDecoration(
                          color: Colors.blue,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(
                          Icons.cloud,
                          color: Colors.white,
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 12),
                      const Text(
                        'Peers Touch',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                // Navigation Items
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    children: [
                      _buildNavItem(
                        icon: Icons.home,
                        label: 'Home',
                        isSelected: selectedIndex == 0,
                        onTap: () => setState(() => selectedIndex = 0),
                      ),
                      _buildNavItem(
                        icon: Icons.folder,
                        label: 'Files',
                        isSelected: selectedIndex == 1,
                        onTap: () => setState(() => selectedIndex = 1),
                      ),
                      _buildNavItem(
                        icon: Icons.description,
                        label: 'Paper',
                        isSelected: selectedIndex == 2,
                        onTap: () => setState(() => selectedIndex = 2),
                      ),
                      _buildNavItem(
                        icon: Icons.slideshow,
                        label: 'Peers-Center',
                        isSelected: selectedIndex == 3,
                        onTap: () => setState(() => selectedIndex = 3),
                      ),
                    ],
                  ),
                ),
                // Upgrade Section
                Container(
                  margin: const EdgeInsets.all(16),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF4CAF50),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(
                            Icons.upgrade,
                            color: Colors.white,
                            size: 20,
                          ),
                          const SizedBox(width: 8),
                          const Text(
                            'Upgrade',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Account',
                        style: TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                // Personal Section
                Container(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Personal',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        '10.7 MB',
                        style: TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // Main Content
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header
                  Row(
                    children: [
                      Text(
                        _titleForIndex(selectedIndex),
                        style: const TextStyle(
                          fontSize: 32,
                          fontWeight: FontWeight.w700,
                          color: Color(0xFF1A1A1A),
                        ),
                      ),
                      const Spacer(),
                      // Search Bar
                      Container(
                        width: 300,
                        height: 40,
                        decoration: BoxDecoration(
                          color: const Color(0xFFF1F3F4),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: const TextField(
                          decoration: InputDecoration(
                            hintText: 'Search your content',
                            prefixIcon: Icon(Icons.search, color: Colors.grey),
                            border: InputBorder.none,
                            contentPadding: EdgeInsets.symmetric(vertical: 12),
                          ),
                        ),
                      ),
                      const SizedBox(width: 16),
                      // Profile
                      CircleAvatar(
                        radius: 20,
                        backgroundColor: Colors.orange,
                        child: const Text(
                          'BE',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 32),
                  // Content Switcher
                  if (selectedIndex == 3)
                    Expanded(child: PeersCenterPage(backend: _backend))
                  else
                    Expanded(child: Container(
                    width: 400,
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF3CD),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 60,
                              height: 60,
                              decoration: BoxDecoration(
                                color: Colors.orange,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: const Icon(
                                Icons.home,
                                color: Colors.white,
                                size: 30,
                              ),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'Project',
                                    style: TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  const Text(
                                    'We should be ready to reveal the new\nproject next week and we are very excited',
                                    style: TextStyle(
                                      color: Colors.black87,
                                      fontSize: 14,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        // Task Items
                        _buildTaskItem('Creating storyboard', '@Bruce Patterson', false),
                        _buildTaskItem('Preparing the source files', '@Charlie Huff', true),
                      ],
                    ),
                  )),
                  const SizedBox(height: 16),
                ],
              ),
            ),
          ),
          // Right Sidebar
          Container(
            width: 300,
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                // Profile Card
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8E3FF),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Column(
                    children: [
                      Container(
                        width: 60,
                        height: 60,
                        decoration: BoxDecoration(
                          color: Colors.purple.shade200,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Icon(
                          Icons.headphones,
                          color: Colors.purple,
                          size: 30,
                        ),
                      ),
                      const SizedBox(height: 12),
                      const Text(
                        'Billie Eilish',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const Text(
                        '1.9 MB · Modified 3 hours ago',
                        style: TextStyle(
                          color: Colors.black54,
                          fontSize: 12,
                        ),
                      ),
                      const SizedBox(height: 12),
                      // Audio waveform placeholder
                      Container(
                        height: 40,
                        decoration: BoxDecoration(
                          color: Colors.purple.shade100,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Center(
                          child: Text(
                            '♪ ♫ ♪ ♫ ♪ ♫ ♪ ♫',
                            style: TextStyle(
                              color: Colors.purple,
                              fontSize: 16,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          IconButton(
                            onPressed: () {},
                            icon: const Icon(Icons.link),
                          ),
                          IconButton(
                            onPressed: () {},
                            icon: const Icon(Icons.more_horiz),
                          ),
                          Container(
                            width: 40,
                            height: 40,
                            decoration: BoxDecoration(
                              color: const Color(0xFF2B3A67),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: const Icon(
                              Icons.play_arrow,
                              color: Colors.white,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                // Collaborators
                Row(
                  children: [
                    Stack(
                      children: [
                        CircleAvatar(
                          radius: 16,
                          backgroundColor: Colors.blue,
                          child: const Text('A', style: TextStyle(color: Colors.white, fontSize: 12)),
                        ),
                        Positioned(
                          left: 20,
                          child: CircleAvatar(
                            radius: 16,
                            backgroundColor: Colors.green,
                            child: const Text('B', style: TextStyle(color: Colors.white, fontSize: 12)),
                          ),
                        ),
                        Positioned(
                          left: 40,
                          child: CircleAvatar(
                            radius: 16,
                            backgroundColor: Colors.orange,
                            child: const Text('C', style: TextStyle(color: Colors.white, fontSize: 12)),
                          ),
                        ),
                        Positioned(
                          left: 60,
                          child: Container(
                            width: 32,
                            height: 32,
                            decoration: BoxDecoration(
                              color: Colors.grey.shade300,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.add, size: 16),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                // Comments
                Row(
                  children: [
                    CircleAvatar(
                      radius: 16,
                      backgroundColor: Colors.blue,
                      child: const Text('M', style: TextStyle(color: Colors.white, fontSize: 12)),
                    ),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text(
                        '@Marie We need to make sure to review the cover',
                        style: TextStyle(fontSize: 12),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    CircleAvatar(
                      radius: 16,
                      backgroundColor: Colors.orange,
                      child: const Text('U', style: TextStyle(color: Colors.white, fontSize: 12)),
                    ),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: TextField(
                        decoration: InputDecoration(
                          hintText: 'Write a comment',
                          border: InputBorder.none,
                          hintStyle: TextStyle(fontSize: 12),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
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
            size: 16,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              task,
              style: TextStyle(
                fontSize: 14,
                decoration: isCompleted ? TextDecoration.lineThrough : null,
              ),
            ),
          ),
          Text(
            assignee,
            style: const TextStyle(
              fontSize: 12,
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
      padding: const EdgeInsets.all(16),
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
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(
              icon,
              color: color,
              size: 20,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                  ),
                ),
                Text(
                  type,
                  style: const TextStyle(
                    color: Colors.grey,
                    fontSize: 12,
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
