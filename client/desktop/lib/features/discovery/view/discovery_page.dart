import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/shell/widgets/three_pane_scaffold.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/shell/controller/right_panel_mode.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import '../controller/discovery_controller.dart';
import '../model/discovery_item.dart';
import 'composer_page.dart';

class DiscoveryPage extends GetView<DiscoveryController> {
  const DiscoveryPage({super.key});

  @override
  Widget build(BuildContext context) {
    final shell = Get.find<ShellController>();
    
    return ShellThreePane(
      leftBuilder: (context) => _buildSidebar(context),
      centerBuilder: (context) => _buildContentList(context, shell),
      leftProps: const PaneProps(
        width: 260,
        minWidth: 240,
        maxWidth: 320,
        padding: EdgeInsets.zero,
      ),
    );
  }

  Widget _buildSidebar(BuildContext context) {
    return Container(
      color: Theme.of(context).colorScheme.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // New Post Button
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
            child: ElevatedButton.icon(
              onPressed: () {
                Get.dialog(
                  const Dialog(
                    child: ComposerPage(),
                  ),
                );
              },
              icon: const Icon(Icons.edit),
              label: const Text('New Post'),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
              ),
            ),
          ),

          // 1. Search Box
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: SearchInput(
              onChanged: controller.setSearchQuery,
              hintText: 'Search',
            ),
          ),
          
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // 2. Groups Section
                  _buildSectionHeader('YOUR GROUP'),
                  Obx(() => Column(
                    children: controller.groups.map((group) => _buildGroupItem(group)).toList(),
                  )),
                  
                  const SizedBox(height: 24),
                  
                  // 3. Friends Section
                  _buildSectionHeader('FRIENDS'),
                  Obx(() => Column(
                    children: controller.friends.map((friend) => _buildFriendItem(friend)).toList(),
                  )),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 8, 16, 8),
      child: Text(
        title,
        style: const TextStyle(
          color: Colors.grey,
          fontSize: 12,
          fontWeight: FontWeight.bold,
          letterSpacing: 1.0,
        ),
      ),
    );
  }

  Widget _buildGroupItem(GroupItem group) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 0),
      leading: Container(
        width: 24,
        height: 24,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          image: DecorationImage(
            image: NetworkImage(group.iconUrl),
            fit: BoxFit.cover,
          ),
        ),
      ),
      title: Text(
        group.name,
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
      ),
      dense: true,
      onTap: () {},
    );
  }

  Widget _buildFriendItem(FriendItem friend) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 0),
      leading: CircleAvatar(
        radius: 12,
        backgroundImage: NetworkImage(friend.avatarUrl),
      ),
      title: Text(
        friend.name,
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
      ),
      trailing: friend.isOnline 
          ? Container(
              width: 8,
              height: 8,
              decoration: const BoxDecoration(
                color: Colors.cyanAccent,
                shape: BoxShape.circle,
              ),
            )
          : Text(
              friend.timeOrStatus,
              style: const TextStyle(color: Colors.grey, fontSize: 10),
            ),
      dense: true,
      onTap: () {},
    );
  }

  Widget _buildContentList(BuildContext context, ShellController shell) {
    return Stack(
      children: [
        Positioned.fill(
          child: Container(
            color: const Color(0xFFF5F7FB),
            child: RefreshableList(
              onRefresh: controller.refreshItems,
              child: Obx(() {
                if (controller.isLoading.value) {
                  return _buildSkeletonList();
                }

                final items = controller.items;
                if (items.isEmpty) {
                  return ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: const [
                      SizedBox(height: 200),
                      Center(child: Text('No items found')),
                    ],
                  );
                }

                return ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  controller: controller.scrollController,
                  padding: const EdgeInsets.fromLTRB(24, 72, 24, 24),
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 24),
                  itemBuilder: (ctx, i) {
                    final item = items[i];
                    return InkWell(
                      onTap: () {
                        controller.selectItem(item);
                        shell.openRightPanelWithOptions(
                          (ctx) => _DiscoveryDetailView(item: item),
                          mode: RightPanelMode.cover,
                          collapsedByDefault: false,
                          widthMode: RightPanelWidthMode.adaptive,
                        );
                      },
                      child: Container(
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.05),
                              blurRadius: 20,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Padding(
                              padding: const EdgeInsets.all(20),
                              child: Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                    decoration: BoxDecoration(
                                      color: _getTypeColor(item.type),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Column(
                                      children: [
                                        Text(
                                          _getMonth(item.timestamp),
                                          style: const TextStyle(
                                            fontSize: 10,
                                            fontWeight: FontWeight.bold,
                                            color: Colors.white,
                                          ),
                                        ),
                                        Text(
                                          item.timestamp.day.toString().padLeft(2, '0'),
                                          style: const TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.bold,
                                            color: Colors.white,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 16),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          item.title,
                                          style: const TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                        const SizedBox(height: 4),
                                        Row(
                                          children: [
                                            Text(
                                              item.type.toUpperCase(),
                                              style: const TextStyle(
                                                color: Colors.grey,
                                                fontSize: 12,
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                            const SizedBox(width: 8),
                                            const Icon(Icons.circle, size: 4, color: Colors.grey),
                                            const SizedBox(width: 8),
                                            const Text(
                                              'Activity',
                                              style: TextStyle(
                                                color: Colors.grey,
                                                fontSize: 12,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                  const Icon(Icons.more_horiz, color: Colors.grey),
                                ],
                              ),
                            ),
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 20),
                              child: Text(
                                item.content,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: Colors.grey[600],
                                  height: 1.5,
                                ),
                              ),
                            ),
                            const SizedBox(height: 20),
                            Padding(
                              padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                              child: Row(
                                children: const [
                                  CircleAvatar(
                                    radius: 12,
                                    backgroundImage: NetworkImage('https://i.pravatar.cc/150?u=8'),
                                  ),
                                  SizedBox(width: 8),
                                  Spacer(),
                                  SizedBox(width: 12),
                                  Icon(Icons.local_fire_department, color: Colors.orange, size: 16),
                                  SizedBox(width: 4),
                                  Text(
                                    '12',
                                    style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 12,
                                    ),
                                  ),
                                  SizedBox(width: 12),
                                  Icon(Icons.share, color: Colors.cyan, size: 16),
                                  SizedBox(width: 4),
                                  Text(
                                    '30',
                                    style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                );
              }),
            ),
          ),
        ),
        Positioned(
          top: 12,
          left: 0,
          right: 0,
          child: SafeArea(
            top: true,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1200),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Obx(() {
                    final alpha = controller.isScrolling.value ? 0.45 : 0.92;
                    final opacity = controller.isScrolling.value ? 0.6 : 1.0;
                    return AnimatedOpacity(
                      duration: const Duration(milliseconds: 180),
                      opacity: opacity,
                      child: IconTabs(
                        items: controller.tabIcons
                            .map((icon) => IconTabItem(icon: icon))
                            .toList(),
                        selectedIndex: controller.currentTab.value,
                        onChanged: controller.setTab,
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF0F6FF).withOpacity(alpha),
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.08),
                              blurRadius: 20,
                              offset: const Offset(0, 8),
                            ),
                          ],
                        ),
                        selectedItemDecoration: BoxDecoration(
                          color: Colors.transparent,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: const Color(0xFFB0C4DE),
                            width: 1.5,
                          ),
                        ),
                        selectedIconColor: const Color(0xFF003087),
                        unselectedIconColor: const Color(0xFF78909C),
                      ),
                    );
                  }),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildSkeletonList() {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(24, 72, 24, 24),
      itemCount: 5,
      separatorBuilder: (_, __) => const SizedBox(height: 24),
      itemBuilder: (ctx, i) => _buildSkeletonItem(),
    );
  }

  Widget _buildSkeletonItem() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 20,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Date Box Skeleton
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: Colors.grey[200],
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Title Skeleton
                    Container(
                      width: 200,
                      height: 16,
                      decoration: BoxDecoration(
                        color: Colors.grey[200],
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 8),
                    // Type Skeleton
                    Container(
                      width: 80,
                      height: 12,
                      decoration: BoxDecoration(
                        color: Colors.grey[200],
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          // Content Skeleton
          Container(
            width: double.infinity,
            height: 14,
            decoration: BoxDecoration(
              color: Colors.grey[200],
              borderRadius: BorderRadius.circular(4),
            ),
          ),
          const SizedBox(height: 8),
          Container(
            width: 200,
            height: 14,
            decoration: BoxDecoration(
              color: Colors.grey[200],
              borderRadius: BorderRadius.circular(4),
            ),
          ),
        ],
      ),
    );
  }

  Color _getTypeColor(String type) {
    switch (type.toLowerCase()) {
      case 'create': return Colors.blue;
      case 'like': return Colors.pink;
      case 'follow': return Colors.purple;
      case 'announce': return Colors.green;
      case 'comment': return Colors.orange;
      default: return Colors.cyanAccent;
    }
  }
  
  String _getMonth(DateTime date) {
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return months[date.month - 1];
  }
}

class _DiscoveryDetailView extends StatelessWidget {
  final DiscoveryItem item;
  const _DiscoveryDetailView({required this.item});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Theme.of(context).colorScheme.surface,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 800),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Top Bar
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Row(
                  children: [
                    const Icon(Icons.notifications_none),
                    const Spacer(),
                    const CircleAvatar(
                      radius: 16,
                      backgroundImage: NetworkImage('https://i.pravatar.cc/150?u=user'),
                    ),
                    const SizedBox(width: 8),
                    const Text(
                      'Adam Lalana',
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                    const Icon(Icons.arrow_drop_down),
                  ],
                ),
              ),
              
              Expanded(
                child: Scrollbar(
                  thumbVisibility: true,
                  child: SingleChildScrollView(
                    primary: true,
                    padding: const EdgeInsets.symmetric(vertical: 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // Video/Image Placeholder
                        Container(
                          height: 200,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(20),
                            image: const DecorationImage(
                              image: NetworkImage('https://picsum.photos/400/300'),
                              fit: BoxFit.cover,
                            ),
                          ),
                    child: Stack(
                      children: [
                        Positioned(
                          top: 12,
                          left: 12,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.red,
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: const Row(
                              children: [
                                Text('LIVE', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                                SizedBox(width: 4),
                                Icon(Icons.visibility, color: Colors.white, size: 10),
                                SizedBox(width: 2),
                                Text('3456', style: TextStyle(color: Colors.white, fontSize: 10)),
                              ],
                            ),
                          ),
                        ),
                        const Center(
                          child: Icon(Icons.play_circle_fill, color: Colors.white, size: 48),
                        ),
                      ],
                    ),
                  ),
                  
                  const SizedBox(height: 24),
                  
                  // Chat Area
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.blue[900],
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Text(
                              'Live Chat',
                              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                            ),
                            Spacer(),
                            Icon(Icons.close, color: Colors.white, size: 16),
                          ],
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          '1.5 k Peoples',
                          style: TextStyle(color: Colors.white70, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  
                  const SizedBox(height: 16),
                  
                  // Pinned Message
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.grey[100],
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.push_pin, color: Colors.blue, size: 16),
                        SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Pinned', style: TextStyle(fontSize: 10, color: Colors.grey)),
                              Text(
                                'How to make Youtube subscriber grow faster.',
                                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  
                  const SizedBox(height: 24),
                  
                  // Comments
                  _buildComment(
                    'Suny Suka',
                    'Wow Keep it up dude 🔥🔥',
                    '09:00',
                    'https://i.pravatar.cc/150?u=9',
                  ),
                  const SizedBox(height: 16),
                  _buildComment(
                    'Arman Bahir',
                    'Amazing',
                    '09:01',
                    'https://i.pravatar.cc/150?u=10',
                  ),
                  const SizedBox(height: 16),
                  _buildComment(
                    'John Doe',
                    'Can you look my comment here 😇',
                    '09:10',
                    'https://i.pravatar.cc/150?u=11',
                  ),
                ],
              ),
            ),
          ),
          ),

          // Input Area (Fixed at bottom)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16.0),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.cyanAccent,
                borderRadius: BorderRadius.circular(24),
              ),
              child: Row(
                children: [
                  const Icon(Icons.emoji_emotions_outlined, color: Colors.black54),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: TextField(
                      decoration: InputDecoration(
                        hintText: 'Add your comment',
                        border: InputBorder.none,
                        isDense: true,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.send),
                    onPressed: () {},
                    color: Colors.black87,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
        ),
      ),
    );
  }
  
  Widget _buildComment(String name, String text, String time, String avatar) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          radius: 14,
          backgroundImage: NetworkImage(avatar),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                  Text(time, style: const TextStyle(color: Colors.grey, fontSize: 10)),
                ],
              ),
              const SizedBox(height: 4),
              Text(text, style: TextStyle(color: Colors.grey[700], fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }
}
