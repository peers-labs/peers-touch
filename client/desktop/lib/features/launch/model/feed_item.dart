import 'package:peers_touch_desktop/features/launch/model/content_source.dart';
import 'package:peers_touch_desktop/features/launch/model/quick_action.dart';

enum FeedItemType {
  recommendation,
  pluginContent,
  userContent,
  federationUpdate,
  recentActivity,
}

class FeedItem {
  const FeedItem({
    required this.id,
    required this.type,
    required this.title,
    this.subtitle,
    this.imageUrl,
    required this.timestamp,
    required this.source,
    this.metadata,
    this.actions = const [],
  });

  factory FeedItem.fromJson(Map<String, dynamic> json) {
    return FeedItem(
      id: json['id'] as String,
      type: FeedItemType.values.firstWhere(
        (e) => e.name == json['type'],
        orElse: () => FeedItemType.recommendation,
      ),
      title: json['title'] as String,
      subtitle: json['subtitle'] as String?,
      imageUrl: json['image_url'] as String?,
      timestamp: DateTime.parse(json['timestamp'] as String),
      source: ContentSource.values.firstWhere(
        (e) => e.name == json['source'],
        orElse: () => ContentSource.stationFeed,
      ),
      metadata: json['metadata'] as Map<String, dynamic>?,
      actions: const [],
    );
  }

  final String id;
  final FeedItemType type;
  final String title;
  final String? subtitle;
  final String? imageUrl;
  final DateTime timestamp;
  final ContentSource source;
  final Map<String, dynamic>? metadata;
  final List<QuickAction> actions;

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'type': type.name,
      'title': title,
      'subtitle': subtitle,
      'image_url': imageUrl,
      'timestamp': timestamp.toIso8601String(),
      'source': source.name,
      'metadata': metadata,
    };
  }
}
