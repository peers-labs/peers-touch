import 'package:flutter/material.dart';
import '../model/ai_model_simple.dart';

class AIModelProvider extends ChangeNotifier {
  ModelCapability? _selectedModel;

  ModelCapability? get selectedModel => _selectedModel;

  List<ModelCapability> get availableModels => [
        ModelCapability(
          id: '1',
          displayName: 'GPT-4',
          provider: ModelProvider.openai,
          visionSupported: true,
        ),
        ModelCapability(
          id: '2',
          displayName: 'GPT-3.5 Turbo',
          provider: ModelProvider.openai,
        ),
        ModelCapability(
          id: '3',
          displayName: 'Gemini Pro',
          provider: ModelProvider.google,
          visionSupported: true,
        ),
      ];

  void selectModel(ModelCapability model) {
    _selectedModel = model;
    notifyListeners();
  }
}