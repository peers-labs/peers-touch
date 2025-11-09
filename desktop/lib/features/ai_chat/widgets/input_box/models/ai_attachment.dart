import 'dart:typed_data';

enum AiAttachmentType { image, file, audio }

class AiAttachment {
  final String id;
  final AiAttachmentType type;
  final String mime;
  final Uint8List bytes;
  final String? name;
  final int? size;
  final String source; // clipboard | drag | picker | screenshot | record
  final String? alt;
  final Duration? duration;

  AiAttachment({
    required this.id,
    required this.type,
    required this.mime,
    required this.bytes,
    this.name,
    this.size,
    this.source = 'picker',
    this.alt,
    this.duration,
  });
}