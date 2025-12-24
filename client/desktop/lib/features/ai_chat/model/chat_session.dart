class ChatSession {
  ChatSession({
    required this.id,
    required this.title,
    required this.createdAt,
    this.lastActiveAt,
    this.lastMessage,
  });

  factory ChatSession.fromJson(Map<String, dynamic> json) => ChatSession(
        id: json['id'] as String,
        title: json['title'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        lastActiveAt: json['lastActiveAt'] != null
            ? DateTime.parse(json['lastActiveAt'] as String)
            : null,
        lastMessage: json['lastMessage'] as String?,
      );
  final String id;
  final String title;
  final DateTime createdAt;
  final DateTime? lastActiveAt;
  final String? lastMessage;

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'createdAt': createdAt.toIso8601String(),
        if (lastActiveAt != null) 'lastActiveAt': lastActiveAt!.toIso8601String(),
        if (lastMessage != null) 'lastMessage': lastMessage,
      };
}