import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/launch/controller/launch_controller.dart';
import 'package:peers_touch_desktop/features/launch/controller/search_controller.dart';
import 'package:peers_touch_desktop/features/launch/view/components/feed_section.dart';
import 'package:peers_touch_desktop/features/launch/view/components/quick_action_grid.dart';
import 'package:peers_touch_desktop/features/launch/view/components/spotlight_search_bar.dart';

class LaunchPage extends StatelessWidget {
  const LaunchPage({super.key});

  @override
  Widget build(BuildContext context) {
    final launchController = Get.find<LaunchController>();
    final searchController = Get.find<LaunchSearchController>();
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      body: SafeArea(
        child: Column(
          children: [
            const SpotlightSearchBar(),
            Expanded(
              child: Obx(() {
                if (launchController.isLoading.value) {
                  return const Center(
                    child: CircularProgressIndicator(),
                  );
                }

                if (searchController.searchQuery.value.isNotEmpty) {
                  return _SearchResultsView();
                }

                return SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      QuickActionGrid(),
                      SizedBox(height: 8),
                      FeedSection(),
                    ],
                  ),
                );
              }),
            ),
          ],
        ),
      ),
    );
  }
}

class _SearchResultsView extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final controller = Get.find<LaunchSearchController>();
    final theme = Theme.of(context);

    return Obx(() {
      if (controller.isSearching.value) {
        return const Center(
          child: CircularProgressIndicator(),
        );
      }

      if (controller.searchResults.isEmpty) {
        return Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.search_off,
                size: 64,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
              ),
              const SizedBox(height: 16),
              Text(
                'No results found',
                style: theme.textTheme.titleMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                ),
              ),
            ],
          ),
        );
      }

      return ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'Search Results',
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Search functionality will be implemented with providers',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
            ),
          ),
        ],
      );
    });
  }
}
