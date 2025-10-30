class MessageModel {
  final String messageId;
  final String chatId;
  final String senderId;
  final String receiverId;
  final String content;
  final int timestamp; // milliseconds since epoch
  final String status; // 'sending', 'sent', 'read', 'failed'
  final bool isMine;
  final String messageType; // 'text', 'system'
  final bool isForwarded;

  const MessageModel({
    required this.messageId,
    required this.chatId,
    required this.senderId,
    required this.receiverId,
    required this.content,
    required this.timestamp,
    required this.status,
    required this.isMine,
    required this.messageType,
    required this.isForwarded,
  });

  MessageModel copyWith({
    String? messageId,
    String? chatId,
    String? senderId,
    String? receiverId,
    String? content,
    int? timestamp,
    String? status,
    bool? isMine,
    String? messageType,
    bool? isForwarded,
  }) {
    return MessageModel(
      messageId: messageId ?? this.messageId,
      chatId: chatId ?? this.chatId,
      senderId: senderId ?? this.senderId,
      receiverId: receiverId ?? this.receiverId,
      content: content ?? this.content,
      timestamp: timestamp ?? this.timestamp,
      status: status ?? this.status,
      isMine: isMine ?? this.isMine,
      messageType: messageType ?? this.messageType,
      isForwarded: isForwarded ?? this.isForwarded,
    );
  }

  bool isSameDay(MessageModel other) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp);
    final otherDate = DateTime.fromMillisecondsSinceEpoch(other.timestamp);
    return date.year == otherDate.year && 
           date.month == otherDate.month && 
           date.day == otherDate.day;
  }

  String getFormattedTime() {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp);
    return '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }
}