enum AttachmentType {
  IMAGE,
  FILE,
  AUDIO,
  VIDEO,
  STICKER,
  LOCATION,
  CONTACT,
}

class MessageAttachment {
  final AttachmentType type;
  final String url;
  final String? thumbnailUrl;
  final int? fileSize;
  final String? fileName;
  final Map<String, dynamic>? metadata;

  const MessageAttachment({
    required this.type,
    required this.url,
    this.thumbnailUrl,
    this.fileSize,
    this.fileName,
    this.metadata,
  });

  MessageAttachment copyWith({
    AttachmentType? type,
    String? url,
    String? thumbnailUrl,
    int? fileSize,
    String? fileName,
    Map<String, dynamic>? metadata,
  }) {
    return MessageAttachment(
      type: type ?? this.type,
      url: url ?? this.url,
      thumbnailUrl: thumbnailUrl ?? this.thumbnailUrl,
      fileSize: fileSize ?? this.fileSize,
      fileName: fileName ?? this.fileName,
      metadata: metadata ?? this.metadata,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'type': type.name,
      'url': url,
      'thumbnailUrl': thumbnailUrl,
      'fileSize': fileSize,
      'fileName': fileName,
      'metadata': metadata,
    };
  }

  factory MessageAttachment.fromJson(Map<String, dynamic> json) {
    return MessageAttachment(
      type: AttachmentType.values.firstWhere(
        (e) => e.name == json['type'],
        orElse: () => AttachmentType.FILE,
      ),
      url: json['url'] as String,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      fileSize: json['fileSize'] as int?,
      fileName: json['fileName'] as String?,
      metadata: json['metadata'] as Map<String, dynamic>?,
    );
  }

  @override
  String toString() {
    return 'MessageAttachment(type: $type, url: $url, fileName: $fileName, fileSize: $fileSize)';
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;

    return other is MessageAttachment &&
        other.type == type &&
        other.url == url &&
        other.thumbnailUrl == thumbnailUrl &&
        other.fileSize == fileSize &&
        other.fileName == fileName;
  }

  @override
  int get hashCode {
    return type.hashCode ^
        url.hashCode ^
        thumbnailUrl.hashCode ^
        fileSize.hashCode ^
        fileName.hashCode;
  }
}
