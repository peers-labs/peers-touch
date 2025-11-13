class ChatUser {
  final String id;
  final String handle;
  final String displayName;
  final String? avatarUrl;
  final String? note;
  final String? domain;

  const ChatUser({
    required this.id,
    required this.handle,
    required this.displayName,
    this.avatarUrl,
    this.note,
    this.domain,
  });
}