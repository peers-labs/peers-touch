class ChatMessage {

  ChatMessage({
    required this.id,
    required this.from,
    required this.to,
    required this.content,
    required this.time,
  });
  final String id;
  final String from;
  final String to;
  final String content;
  final DateTime time;
}