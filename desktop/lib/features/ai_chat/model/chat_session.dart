class ChatSession {
  final String id;
  final String title;
  final DateTime createdAt;
  final DateTime? lastActiveAt;
  // 每会话绑定的模型ID（可为空，表示使用全局默认）
  final String? modelId;
  // 会话头像（base64 编码的图片数据，便于跨平台存储与预览）
  final String? avatarBase64;
  ChatSession({
    required this.id,
    required this.title,
    required this.createdAt,
    this.lastActiveAt,
    this.modelId,
    this.avatarBase64,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'createdAt': createdAt.toIso8601String(),
        if (lastActiveAt != null) 'lastActiveAt': lastActiveAt!.toIso8601String(),
        if (modelId != null) 'modelId': modelId,
        if (avatarBase64 != null) 'avatarBase64': avatarBase64,
      };

  factory ChatSession.fromJson(Map<String, dynamic> json) => ChatSession(
        id: json['id'] as String,
        title: json['title'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        lastActiveAt: json['lastActiveAt'] != null
            ? DateTime.parse(json['lastActiveAt'] as String)
            : null,
        modelId: json['modelId'] as String?,
        avatarBase64: json['avatarBase64'] as String?,
      );
}