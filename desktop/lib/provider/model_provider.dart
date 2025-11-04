import 'package:flutter/foundation.dart';
import 'package:desktop/model/ai_model_simple.dart';

class AIModelProvider extends ChangeNotifier {
  ModelCapability? _selectedModel;
  bool _isLoading = false;
  
  ModelCapability? get selectedModel => _selectedModel;
  bool get isLoading => _isLoading;
  
  void selectModel(ModelCapability model) {
    _selectedModel = model;
    notifyListeners();
  }
  
  void setLoading(bool loading) {
    _isLoading = loading;
    notifyListeners();
  }
  
  List<ModelCapability> get availableModels => [
    ModelCapability(
      id: 'llama3.2:latest',
      displayName: 'Llama 3.2 Latest',
      provider: ModelProvider.ollama,
      visionSupported: false,
      fileUploadSupported: true,
      ttsSupported: false,
      sttSupported: false,
      toolCallingSupported: true,
      webSearchSupported: false,
      maxContextWindow: 8192,
    ),
    ModelCapability(
      id: 'qwen2.5:latest',
      displayName: 'Qwen 2.5 Latest',
      provider: ModelProvider.ollama,
      visionSupported: false,
      fileUploadSupported: true,
      ttsSupported: false,
      sttSupported: false,
      toolCallingSupported: true,
      webSearchSupported: false,
      maxContextWindow: 32768,
    ),
    ModelCapability(
      id: 'deepseek-coder:latest',
      displayName: 'DeepSeek Coder Latest',
      provider: ModelProvider.ollama,
      visionSupported: false,
      fileUploadSupported: true,
      ttsSupported: false,
      sttSupported: false,
      toolCallingSupported: true,
      webSearchSupported: false,
      maxContextWindow: 16384,
    ),
    ModelCapability(
      id: 'codellama:latest',
      displayName: 'Code Llama Latest',
      provider: ModelProvider.ollama,
      visionSupported: false,
      fileUploadSupported: true,
      ttsSupported: false,
      sttSupported: false,
      toolCallingSupported: false,
      webSearchSupported: false,
      maxContextWindow: 16384,
    ),
  ];
  
  AIModelProvider() {
    // 设置默认模型
    if (availableModels.isNotEmpty) {
      _selectedModel = availableModels.first;
    }
  }
}