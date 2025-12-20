class DiscoveryItem {
  final String id;
  final String title;
  final String content;
  final String author;
  final DateTime timestamp;
  final String type; // 'post', 'group', 'user'
  final List<String> images;

  DiscoveryItem({
    required this.id,
    required this.title,
    required this.content,
    required this.author,
    required this.timestamp,
    required this.type,
    this.images = const [],
  });
}
