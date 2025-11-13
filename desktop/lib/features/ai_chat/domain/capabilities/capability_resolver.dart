import 'package:peers_touch_desktop/features/ai_chat/domain/models/model_capability.dart';

/// 根据 Provider 类型与模型ID推断能力（启发式规则）。
class CapabilityResolver {
  static ModelCapability resolve({required String provider, required String modelId}) {
    final m = modelId.toLowerCase();
    final p = provider.toLowerCase();

    // OpenAI 家族（对齐 2024-2025 常见模型命名）
    if (p.contains('openai')) {
      if (m.contains('gpt-4o') || m.contains('omni') || m.contains('gpt-4.1')) {
        // 视觉与音频输入
        return const ModelCapability(
          supportsText: true,
          supportsImageInput: true,
          supportsFileInput: true,
          supportsAudioInput: true,
          supportsStreaming: true,
          maxImages: 4,
          maxFiles: 8,
          maxAudio: 2,
        );
      }
      if (m.contains('gpt-4o-mini') || m.contains('mini')) {
        // 视觉轻量版，音频有时受限
        return const ModelCapability(
          supportsText: true,
          supportsImageInput: true,
          supportsFileInput: true,
          supportsAudioInput: false,
          supportsStreaming: true,
          maxImages: 4,
          maxFiles: 4,
          maxAudio: 0,
        );
      }
      // 3.5/旧4 不支持视觉
      return const ModelCapability(
        supportsText: true,
        supportsImageInput: false,
        supportsFileInput: true,
        supportsAudioInput: false,
        supportsStreaming: true,
        maxFiles: 4,
      );
    }

    // Ollama（llava/vision 系列支持视觉）
    if (p.contains('ollama')) {
      final isVision = m.contains('llava') || m.contains('vision') || m.contains('llama3.2') || m.contains('phi-3-vision');
      if (isVision) {
        return const ModelCapability(
          supportsText: true,
          supportsImageInput: true,
          supportsFileInput: false,
          supportsAudioInput: false,
          supportsStreaming: true,
          maxImages: 4,
        );
      }
      return const ModelCapability(
        supportsText: true,
        supportsImageInput: false,
        supportsFileInput: false,
        supportsAudioInput: false,
        supportsStreaming: true,
      );
    }

    // 默认：仅文本
    return ModelCapability.textOnly;
  }
}