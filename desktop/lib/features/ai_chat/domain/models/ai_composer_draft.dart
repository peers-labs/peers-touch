import 'dart:convert';
import 'package:peers_touch_desktop/features/ai_chat/domain/models/ai_attachment.dart';

class AiComposerDraft {
  final String text;
  final List<AiAttachment> attachments;
  final String sendMode;

  AiComposerDraft({required this.text, required this.attachments, this.sendMode = 'enter'});

  List<Map<String, dynamic>> toOpenAIContent() {
    final items = <Map<String, dynamic>>[];
    if (text.trim().isNotEmpty) {
      items.add({'type': 'text', 'text': text});
    }
    for (final a in attachments) {
      switch (a.type) {
        case AiAttachmentType.image:
          final base64 = _base64DataUrl(a.mime, a.bytes);
          items.add({'type': 'image_url', 'image_url': {'url': base64}});
          break;
        case AiAttachmentType.file:
          items.add({'type': 'file', 'file': {'name': a.name ?? a.id, 'mime': a.mime, 'data': _bytesToBase64(a.bytes)}});
          break;
        case AiAttachmentType.audio:
          items.add({'type': 'input_audio', 'audio': {'mime': a.mime, 'data': _bytesToBase64(a.bytes)}});
          break;
      }
    }
    return items;
  }

  String _bytesToBase64(List<int> bytes) => base64Encode(bytes);

  String _base64DataUrl(String mime, List<int> bytes) => 'data:$mime;base64,${_bytesToBase64(bytes)}';
}