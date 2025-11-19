class RichModel {
  final String id;
  final String providerId; // Reverse reference for easy lookup
  final String name;
  final String description;
  final Set<String> _capabilities;

  RichModel({
    required this.id,
    required this.providerId,
    required this.name,
    required this.description,
    required Set<String> capabilities,
  }) : _capabilities = capabilities;

  // "Rich" methods that provide business logic
  bool get supportsTextInput => _capabilities.contains('textInput');
  bool get supportsImageInput => _capabilities.contains('imageInput');
  bool get supportsAudioInput => _capabilities.contains('audioInput');
  bool get supportsFileInput => _capabilities.contains('fileInput');
  bool get isMultiModal => _capabilities.length > 1;

  /// 检查是否支持指定功能
  bool supportsCapability(String capability) => _capabilities.contains(capability);
}