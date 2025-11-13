import 'dart:typed_data';

enum ChatAttachmentType { image, file, audio }

class ChatAttachment {
  final String id;
  final ChatAttachmentType type;
  final String mime;
  final int? size;
  final String? url;
  final Uint8List? bytes;
  final String? name;

  const ChatAttachment({
    required this.id,
    required this.type,
    required this.mime,
    this.size,
    this.url,
    this.bytes,
    this.name,
  });
}