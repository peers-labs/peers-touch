class ModelCapability {
  final bool supportsText;
  final bool supportsImageInput;
  final bool supportsFileInput;
  final bool supportsAudioInput;
  final bool supportsStreaming;
  final int maxImages;
  final int maxFiles;
  final int maxAudio;
  final List<String> allowedMimeTypes;

  const ModelCapability({
    this.supportsText = true,
    this.supportsImageInput = false,
    this.supportsFileInput = false,
    this.supportsAudioInput = false,
    this.supportsStreaming = true,
    this.maxImages = 4,
    this.maxFiles = 4,
    this.maxAudio = 1,
    this.allowedMimeTypes = const [
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/json',
      'audio/wav',
      'audio/webm',
      'audio/mpeg',
    ],
  });

  static const ModelCapability textOnly = ModelCapability();

  @override
  String toString() {
    return 'ModelCapability(text: $supportsText, image: $supportsImageInput, file: $supportsFileInput, audio: $supportsAudioInput, streaming: $supportsStreaming)';
  }
}