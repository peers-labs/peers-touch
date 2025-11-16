class ChatSession {
  final String id;
  final String title;
  final DateTime createdAt;
  final DateTime? lastActiveAt;
  final String? lastMessage;
  
  ChatSession({
    required this.id,
    required this.title,
    required this.createdAt,
    this.lastActiveAt,
    this.lastMessage,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'createdAt': createdAt.toIso8601String(),
        if (lastActiveAt != null) 'lastActiveAt': lastActiveAt!.toIso8601String(),
        if (lastMessage != null) 'lastMessage': lastMessage,
      };

  factory ChatSession.fromJson(Map<String, dynamic> json) => ChatSession(
        id: json['id'] as String,
        title: json['title'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        lastActiveAt: json['lastActiveAt'] != null
            ? DateTime.parse(json['lastActiveAt'] as String)
            : null,
        lastMessage: json['lastMessage'] as String?,
      );
  
  ChatSession copyWith({
    String? id,
    String? title,
    DateTime? createdAt,
    DateTime? lastActiveAt,
    String? lastMessage,
  }) {
    return ChatSession(
      id: id ?? this.id,
      title: title ?? this.title,
      createdAt: createdAt ?? this.createdAt,
      lastActiveAt: lastActiveAt ?? this.lastActiveAt,
      lastMessage: lastMessage ?? this.lastMessage,
    );
  }
}