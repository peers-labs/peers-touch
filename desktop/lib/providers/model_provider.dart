import 'package:flutter/foundation.dart';
import 'package:desktop/models/ai_model_simple.dart';
import 'package:desktop/models/ai_models.dart';

class AIModelProvider with ChangeNotifier {
  List<ModelCapability> _availableModels = [];
  ModelCapability? _selectedModel;

  AIModelProvider() {
    _loadModels();
  }

  List<ModelCapability> get availableModels => _availableModels;
  ModelCapability? get selectedModel => _selectedModel;

  void _loadModels() {
    // 将来这里会替换为从后端API获取数据的逻辑
    _availableModels = aiModelCapabilities;
    
    // 设置一个默认选中的模型
    if (_availableModels.isNotEmpty) {
      _selectedModel = _availableModels.first;
    }
    
    notifyListeners();
  }

  void selectModel(ModelCapability model) {
    _selectedModel = model;
    notifyListeners();
  }
}