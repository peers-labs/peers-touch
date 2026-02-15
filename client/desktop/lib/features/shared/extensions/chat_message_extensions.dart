import 'package:fixnum/fixnum.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_desktop/features/friend_chat/models/upload_progress.dart';

extension ChatMessageExtensions on ChatMessage {
  ChatMessage copyWithMetadata({
    String? id,
    String? sessionId,
    String? senderId,
    String? content,
    Timestamp? sentAt,
    MessageType? type,
    MessageStatus? status,
    List<MessageAttachment>? attachments,
    Map<String, String>? metadata,
    String? replyToId,
    bool? isDeleted,
  }) {
    return ChatMessage()
      ..id = id ?? this.id
      ..sessionId = sessionId ?? this.sessionId
      ..senderId = senderId ?? this.senderId
      ..content = content ?? this.content
      ..sentAt = (sentAt ?? this.sentAt).clone()
      ..type = type ?? this.type
      ..status = status ?? this.status
      ..attachments.addAll(attachments ?? this.attachments)
      ..metadata.addAll(metadata ?? this.metadata)
      ..replyToId = replyToId ?? this.replyToId
      ..isDeleted = isDeleted ?? this.isDeleted;
  }

  UploadProgress? get uploadProgress {
    if (!metadata.containsKey('uploadProgress')) return null;
    
    final data = metadata['uploadProgress']!.split(',');
    if (data.length != 4) return null;
    
    return UploadProgress(
      percentage: double.tryParse(data[0]) ?? 0.0,
      uploaded: int.tryParse(data[1]) ?? 0,
      total: int.tryParse(data[2]) ?? 0,
      status: UploadStatus.values[int.tryParse(data[3]) ?? 0],
    );
  }

  ChatMessage withUploadProgress(UploadProgress? progress) {
    final newMetadata = Map<String, String>.from(metadata);
    
    if (progress == null) {
      newMetadata.remove('uploadProgress');
    } else {
      newMetadata['uploadProgress'] = '${progress.percentage},${progress.uploaded},${progress.total},${progress.status.index}';
    }
    
    return copyWithMetadata(metadata: newMetadata);
  }

  DateTime get sentAtDateTime => sentAt.toDateTime();

  bool get isFromMe {
    final myDid = metadata['myDid'];
    return myDid != null && senderId == myDid;
  }

  bool get isSending => status == MessageStatus.MESSAGE_STATUS_SENDING;
  bool get isSent => status == MessageStatus.MESSAGE_STATUS_SENT;
  bool get isDelivered => status == MessageStatus.MESSAGE_STATUS_DELIVERED;
  bool get isFailed => status == MessageStatus.MESSAGE_STATUS_FAILED;

  bool get hasAttachments => attachments.isNotEmpty;
  
  MessageAttachment? get firstAttachment => 
      hasAttachments ? attachments.first : null;
}

extension MessageAttachmentExtensions on MessageAttachment {
  bool get isImage => type.toLowerCase().startsWith('image/');
  bool get isVideo => type.toLowerCase().startsWith('video/');
  bool get isAudio => type.toLowerCase().startsWith('audio/');
  
  String get displaySize {
    final bytes = size.toInt();
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
  }
}

class MessageBuilder {
  static ChatMessage create({
    required String senderId,
    required String sessionId,
    required String content,
    MessageType type = MessageType.MESSAGE_TYPE_TEXT,
    MessageStatus status = MessageStatus.MESSAGE_STATUS_SENDING,
    List<MessageAttachment>? attachments,
    String? replyToId,
  }) {
    final now = DateTime.now();
    final id = '${now.millisecondsSinceEpoch}_$senderId';
    
    return ChatMessage()
      ..id = id
      ..sessionId = sessionId
      ..senderId = senderId
      ..content = content
      ..sentAt = Timestamp.fromDateTime(now)
      ..type = type
      ..status = status
      ..attachments.addAll(attachments ?? [])
      ..replyToId = replyToId ?? ''
      ..isDeleted = false;
  }

  static MessageAttachment createAttachment({
    required String name,
    required String url,
    required String type,
    required int size,
    String? thumbnailUrl,
  }) {
    return MessageAttachment()
      ..id = DateTime.now().millisecondsSinceEpoch.toString()
      ..name = name
      ..url = url
      ..type = type
      ..size = Int64(size)
      ..thumbnailUrl = thumbnailUrl ?? '';
  }
}
