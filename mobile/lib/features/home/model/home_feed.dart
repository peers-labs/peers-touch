class HomeFeed {
  final String id;
  final String title;
  final String content;
  final DateTime createdAt;

  HomeFeed({
    required this.id,
    required this.title,
    required this.content,
    required this.createdAt,
  });

  factory HomeFeed.fromJson(Map<String, dynamic> json) => HomeFeed(
        id: json['id'] as String,
        title: json['title'] as String? ?? '',
        content: json['content'] as String? ?? '',
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.now(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'title': title,
        'content': content,
        'createdAt': createdAt.toIso8601String(),
      };
}