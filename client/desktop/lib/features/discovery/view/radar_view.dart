import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import 'package:peers_touch_desktop/features/discovery/controller/discovery_controller.dart';

class RadarView extends StatelessWidget {
  const RadarView({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<DiscoveryController>();

    return Container(
      color: const Color(0xFFF5F7FB),
      child: Column(
        children: [
          _buildSearchHeader(controller),
          Expanded(
            child: _buildUserList(controller),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchHeader(DiscoveryController controller) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 4,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.search, color: Colors.blue, size: 28),
              const SizedBox(width: 12),
              const Text(
                'Find Friends',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const Spacer(),
              Obx(() {
                final displayList = controller.searchQuery.value.isEmpty 
                    ? controller.localStationActors 
                    : controller.searchResults;
                return Text(
                  '${displayList.length} actors',
                  style: const TextStyle(
                    color: Colors.grey,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                );
              }),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            onChanged: controller.searchFriends,
            decoration: InputDecoration(
              hintText: 'Search by username or display name...',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: Obx(() => controller.searchQuery.value.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () => controller.searchFriends(''),
                    )
                  : const SizedBox.shrink()),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(color: Colors.grey.shade300),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(color: Colors.grey.shade300),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Colors.blue, width: 2),
              ),
              filled: true,
              fillColor: Colors.grey.shade50,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildUserList(DiscoveryController controller) {
    return Obx(() {
      if (controller.isLoading.value) {
        return const Center(
          child: CircularProgressIndicator(),
        );
      }

      if (controller.error.value != null) {
        return Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, size: 64, color: Colors.red),
              const SizedBox(height: 16),
              Text(
                controller.error.value!,
                style: const TextStyle(color: Colors.red),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: controller.loadAllUsers,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ),
        );
      }

      final displayList = controller.searchQuery.value.isEmpty 
          ? controller.localStationActors 
          : controller.searchResults;

      if (displayList.isEmpty) {
        return Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.people_outline, size: 64, color: Colors.grey.shade400),
              const SizedBox(height: 16),
              Text(
                controller.searchQuery.value.isEmpty
                    ? 'No actors found on this station'
                    : 'No results for "${controller.searchQuery.value}"',
                style: TextStyle(
                  fontSize: 16,
                  color: Colors.grey.shade600,
                ),
              ),
            ],
          ),
        );
      }

      return ListView.separated(
        padding: const EdgeInsets.all(24),
        itemCount: displayList.length,
        separatorBuilder: (context, index) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final friend = displayList[index];
          return ListTile(
            contentPadding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
            leading: Avatar(
              actorId: friend.actorId ?? friend.id,
              avatarUrl: friend.avatarUrl,
              fallbackName: friend.name,
              size: 56,
            ),
            title: Text(
              friend.name,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 16,
              ),
            ),
            subtitle: Text(
              '@${friend.id}',
              style: TextStyle(
                color: Colors.grey.shade600,
                fontSize: 14,
              ),
            ),
            trailing: _buildFollowButton(friend, controller),
          );
        },
      );
    });
  }

  Widget _buildFollowButton(FriendItem friend, DiscoveryController controller) {
    if (friend.isFollowing && friend.followedBy) {
      return FilledButton(
        onPressed: () => controller.unfollowUser(friend),
        style: FilledButton.styleFrom(
          backgroundColor: Colors.green.shade100,
          foregroundColor: Colors.green.shade700,
        ),
        child: const Text('Friends'),
      );
    } else if (friend.isFollowing) {
      return FilledButton(
        onPressed: () => controller.unfollowUser(friend),
        style: FilledButton.styleFrom(
          backgroundColor: Colors.grey.shade300,
          foregroundColor: Colors.grey.shade700,
        ),
        child: const Text('Following'),
      );
    } else if (friend.followedBy) {
      return FilledButton.tonal(
        onPressed: () => controller.followUser(friend),
        child: const Text('Follow Back'),
      );
    } else {
      return FilledButton.tonal(
        onPressed: () => controller.followUser(friend),
        child: const Text('Follow'),
      );
    }
  }
}
