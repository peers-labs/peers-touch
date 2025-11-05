// 简单的AI模型能力定义，不依赖proto
enum ModelProvider {
  unspecified,
  openai,
  google,
  anthropic,
  moonshot,
  ollama,
  custom,
}

class ModelCapability {
  final String id;
  final String displayName;
  final ModelProvider provider;
  
  // 多模态能力标识
  final bool visionSupported;
  final bool fileUploadSupported;
  final bool ttsSupported;
  final bool sttSupported;
  final bool toolCallingSupported;
  final bool webSearchSupported;
  
  // 能力相关参数
  final int maxVisionInput;
  final int maxContextWindow;

  ModelCapability({
    required this.id,
    required this.displayName,
    required this.provider,
    this.visionSupported = false,
    this.fileUploadSupported = false,
    this.ttsSupported = false,
    this.sttSupported = false,
    this.toolCallingSupported = false,
    this.webSearchSupported = false,
    this.maxVisionInput = 0,
    this.maxContextWindow = 0,
  });
}