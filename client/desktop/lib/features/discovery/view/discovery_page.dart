import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/discovery/controller/discovery_controller.dart';
import 'package:peers_touch_desktop/features/discovery/view/components/discovery_content_item.dart';
import 'package:peers_touch_desktop/features/discovery/view/composer_page.dart';
import 'package:peers_touch_desktop/features/discovery/view/radar_view.dart';
import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';
import 'package:peers_touch_desktop/features/shell/widgets/three_pane_scaffold.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';

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
            child: Obx(() {
              if (controller.tabs[controller.currentTab.value] == 'Radar') {
                return const RadarView();
              }
              return RefreshableList(
                onRefresh: controller.refreshItems,
                child: Obx(() {
                  if (controller.isLoading.value) {
                    return _buildSkeletonList();
                  }

                  if (controller.error.value != null && controller.items.isEmpty) {
                    return _buildErrorState(context, controller.error.value!);
                  }

                  final items = controller.items;
                  if (items.isEmpty) {
                    return _buildEmptyState(context);
                  }

                  return ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    controller: controller.scrollController,
                    padding: const EdgeInsets.fromLTRB(24, 72, 24, 24),
                    itemCount: items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 24),
                    itemBuilder: (ctx, i) {
                      final item = items[i];
                      return DiscoveryContentItem(
                        item: item,
                        controller: controller,
                      );
                    },
                  );
                }),
              );
            }),
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
                          color: const Color(0xFFF0F6FF).withValues(alpha: alpha),
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.08),
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
      separatorBuilder: (_, _) => const SizedBox(height: 24),
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
            color: Colors.black.withValues(alpha: 0.05),
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
                      color: Colors.grey[200],
                    ),
                    const SizedBox(height: 8),
                    // Subtitle Skeleton
                    Container(
                      width: 100,
                      height: 12,
                      color: Colors.grey[100],
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          // Content Skeletons
          Container(
            width: double.infinity,
            height: 14,
            color: Colors.grey[100],
          ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            height: 14,
            color: Colors.grey[100],
          ),
          const SizedBox(height: 8),
          Container(
            width: 250,
            height: 14,
            color: Colors.grey[100],
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(height: MediaQuery.of(context).size.height * 0.25),
        Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.inbox_outlined, size: 64, color: Colors.grey[300]),
              const SizedBox(height: 16),
              Text(
                'No items found',
                style: TextStyle(
                  color: Colors.grey[500],
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Try switching to another tab or refresh later.',
                style: TextStyle(
                  color: Colors.grey[400],
                  fontSize: 14,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildErrorState(BuildContext context, String message) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(height: MediaQuery.of(context).size.height * 0.2),
        Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 40),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.errorContainer.withValues(alpha: 0.5),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.cloud_off_outlined, 
                    size: 64, 
                    color: Theme.of(context).colorScheme.error,
                  ),
                ),
                const SizedBox(height: 24),
                Text(
                  'Loading Failed',
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.error,
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 32),
                FilledButton.icon(
                  onPressed: controller.refreshItems,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Try Again'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
