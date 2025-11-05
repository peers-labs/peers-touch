import 'package:peers_touch_desktop/model/ai_model_simple.dart';

// 这是一个临时的、硬编码的模型能力列表，用于在后端接口完成前进行前端开发。
// 将来这个数据会由后端的 /api/v1/ai/capabilities 接口提供。

final List<ModelCapability> aiModelCapabilities = [
  ModelCapability(
    id: 'gpt-4-vision-preview',
    displayName: 'GPT-4 Vision',
    provider: ModelProvider.openai,
    visionSupported: true,
    fileUploadSupported: false,
    ttsSupported: true,
    sttSupported: false,
    toolCallingSupported: true,
    webSearchSupported: false,
    maxVisionInput: 5,
    maxContextWindow: 128000,
  ),
  ModelCapability(
    id: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    provider: ModelProvider.openai,
    visionSupported: false,
    fileUploadSupported: true,
    ttsSupported: true,
    sttSupported: false,
    toolCallingSupported: true,
    webSearchSupported: true,
    maxContextWindow: 128000,
  ),
  ModelCapability(
    id: 'gemini-pro-vision',
    displayName: 'Gemini Pro Vision',
    provider: ModelProvider.google,
    visionSupported: true,
    fileUploadSupported: false,
    ttsSupported: false,
    sttSupported: true,
    toolCallingSupported: true,
    webSearchSupported: true,
    maxVisionInput: 16,
    maxContextWindow: 32768,
  ),
  ModelCapability(
    id: 'claude-3-opus',
    displayName: 'Claude 3 Opus',
    provider: ModelProvider.anthropic,
    visionSupported: true,
    fileUploadSupported: true,
    ttsSupported: false,
    sttSupported: false,
    toolCallingSupported: true,
    webSearchSupported: false,
    maxVisionInput: 20,
    maxContextWindow: 200000,
  ),
];