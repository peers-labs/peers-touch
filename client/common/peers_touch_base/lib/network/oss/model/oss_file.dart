class OssFile {
  final String key;
  final String url;
  final int size;
  final String mime;
  final String backend;

  OssFile({
    required this.key,
    required this.url,
    required this.size,
    required this.mime,
    required this.backend,
  });

  factory OssFile.fromJson(Map<String, dynamic> json) {
    return OssFile(
      key: json['key']?.toString() ?? '',
      url: json['url']?.toString() ?? '',
      size: int.tryParse(json['size']?.toString() ?? '0') ?? 0,
      mime: json['mime']?.toString() ?? '',
      backend: json['backend']?.toString() ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
    'key': key,
    'url': url,
    'size': size,
    'mime': mime,
    'backend': backend,
  };
}
