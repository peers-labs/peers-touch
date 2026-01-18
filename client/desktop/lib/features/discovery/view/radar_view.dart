import 'package:flutter/material.dart';
import 'package:get/get.dart';
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
                return Text(
                  '${controller.filteredActors.length} actors',
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
          const SizedBox(height: 16),
          _buildFilterChips(controller),
        ],
      ),
    );
  }

  Widget _buildFilterChips(DiscoveryController controller) {
    return Obx(() {
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _buildFilterChip(
              controller,
              'All',
              RelationshipFilter.all,
              Icons.people,
            ),
            const SizedBox(width: 8),
            _buildFilterChip(
              controller,
              'Following',
              RelationshipFilter.following,
              Icons.person_add,
            ),
            const SizedBox(width: 8),
            _buildFilterChip(
              controller,
              'Followers',
              RelationshipFilter.followers,
              Icons.person,
            ),
            const SizedBox(width: 8),
            _buildFilterChip(
              controller,
              'Friends',
              RelationshipFilter.friends,
              Icons.favorite,
            ),
          ],
        ),
      );
    });
  }

  Widget _buildFilterChip(
    DiscoveryController controller,
    String label,
    RelationshipFilter filter,
    IconData icon,
  ) {
    final isSelected = controller.relationshipFilter.value == filter;
    return FilterChip(
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: isSelected ? Colors.white : Colors.blue),
          const SizedBox(width: 4),
          Text(label),
        ],
      ),
      selected: isSelected,
      onSelected: (selected) {
        if (selected) {
          controller.setRelationshipFilter(filter);
        }
      },
      selectedColor: Colors.blue,
      checkmarkColor: Colors.white,
      labelStyle: TextStyle(
        color: isSelected ? Colors.white : Colors.blue,
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
      ),
    );
  }

  Widget _buildUserList(DiscoveryController controller) {
    return Obx(() {
      if (controller.isLoadingActors.value) {
        return const Center(child: CircularProgressIndicator());
      }

      final displayList = controller.filteredActors;

      if (displayList.isEmpty) {
        return Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.people_outline, size: 64, color: Colors.grey.shade400),
              const SizedBox(height: 16),
              Text(
                controller.searchQuery.value.isEmpty 
                    ? 'No actors found'
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

      return ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: displayList.length,
        itemBuilder: (context, index) {
          final friend = displayList[index];
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: Colors.blue.shade100,
                child: Text(
                  friend.name.isNotEmpty ? friend.name[0].toUpperCase() : '?',
                  style: TextStyle(
                    color: Colors.blue.shade700,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              title: Row(
                children: [
                  Expanded(
                    child: Text(
                      friend.name,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    ),
                  ),
                  if (friend.isFriend)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.pink.shade50,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.favorite, size: 12, color: Colors.pink.shade400),
                          const SizedBox(width: 4),
                          Text(
                            'Friends',
                            style: TextStyle(
                              color: Colors.pink.shade700,
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    )
                  else if (friend.followedBy && !friend.isFollowing)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.blue.shade50,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        'Follows you',
                        style: TextStyle(
                          color: Colors.blue.shade700,
                          fontSize: 11,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                ],
              ),
              subtitle: Text(
                '@${friend.id}',
                style: TextStyle(
                  color: Colors.grey.shade600,
                  fontSize: 14,
                ),
              ),
              trailing: _buildActionButton(controller, friend),
            ),
          );
        },
      );
    });
  }

  Widget _buildActionButton(DiscoveryController controller, FriendItem friend) {
    if (friend.isFollowing) {
      return OutlinedButton(
        onPressed: () => controller.unfollowUser(friend),
        child: const Text('Following'),
      );
    } else if (friend.followedBy) {
      return FilledButton(
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
