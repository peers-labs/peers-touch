import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/launch/controller/launch_controller.dart';
import 'package:peers_touch_desktop/features/launch/model/content_source.dart';
import 'package:peers_touch_desktop/features/launch/model/feed_item.dart';

class FeedSection extends StatelessWidget {
  const FeedSection({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<LaunchController>();

    return Obx(() {
      final allItems = controller.getAllFeedItems();

      if (allItems.isEmpty) {
        return const Center(
          child: Padding(
            padding: EdgeInsets.all(40),
            child: Text('No content available'),
          ),
        );
      }

      final groupedItems = _groupBySource(allItems);

      return ListView(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        children: groupedItems.entries.map((entry) {
          return _FeedGroup(
            source: entry.key,
            items: entry.value,
          );
        }).toList(),
      );
    });
  }

  Map<ContentSource, List<FeedItem>> _groupBySource(List<FeedItem> items) {
    final grouped = <ContentSource, List<FeedItem>>{};
    for (final item in items) {
      grouped.putIfAbsent(item.source, () => []).add(item);
    }
    return grouped;
  }
}

class _FeedGroup extends StatelessWidget {
  final ContentSource source;
  final List<FeedItem> items;

  const _FeedGroup({
    required this.source,
    required this.items,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                _getIconForSource(source),
                size: 20,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(width: 8),
              Text(
                _getTitleForSource(source),
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '(${items.length})',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...items.map((item) => _FeedItemCard(item: item)),
        ],
      ),
    );
  }

  IconData _getIconForSource(ContentSource source) {
    switch (source) {
      case ContentSource.stationFeed:
        return Icons.rss_feed;
      case ContentSource.friends:
        return Icons.people_outline;
      case ContentSource.recentChats:
        return Icons.chat_bubble_outline;
      case ContentSource.applets:
        return Icons.apps;
      case ContentSource.recentActivities:
        return Icons.history;
      case ContentSource.federation:
        return Icons.public;
    }
  }

  String _getTitleForSource(ContentSource source) {
    switch (source) {
      case ContentSource.stationFeed:
        return 'Personalized Feed';
      case ContentSource.friends:
        return 'Friends';
      case ContentSource.recentChats:
        return 'Recent Chats';
      case ContentSource.applets:
        return 'Applets';
      case ContentSource.recentActivities:
        return 'Recent Activities';
      case ContentSource.federation:
        return 'Federation';
    }
  }
}

class _FeedItemCard extends StatelessWidget {
  final FeedItem item;

  const _FeedItemCard({required this.item});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: () {},
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: theme.colorScheme.outline.withValues(alpha: 0.1),
            ),
          ),
          child: Row(
            children: [
              if (item.imageUrl != null)
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.image),
                ),
              if (item.imageUrl != null) const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (item.subtitle != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        item.subtitle!,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color:
                              theme.colorScheme.onSurface.withValues(alpha: 0.6),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              Icon(
                Icons.arrow_forward_ios,
                size: 16,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
