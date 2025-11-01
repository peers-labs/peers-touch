import 'package:flutter/material.dart';
import 'package:desktop/models/ai_provider.dart';

class AIProviderState with ChangeNotifier {
  final List<AIProvider> _providers = [
    // Mock data based on the image
    AIProvider(id: 'openai', name: 'OpenAI', icon: Icons.cloud_queue, isEnabled: true),
    AIProvider(id: 'ollama', name: 'Ollama', icon: Icons.memory, isEnabled: true),
    AIProvider(id: 'comfyui', name: 'ComfyUI', icon: Icons.widgets, isEnabled: true),
    AIProvider(id: 'google', name: 'Google', icon: Icons.search, isEnabled: true),
    AIProvider(id: 'moonshot', name: 'Moonshot', icon: Icons.rocket_launch, isEnabled: true),
    AIProvider(id: 'fal', name: 'Fal', icon: Icons.flash_on, isEnabled: true),
    AIProvider(id: 'bytedance-kimi2', name: 'bytedance-kimi2', icon: Icons.android, isEnabled: true),
    AIProvider(id: 'azure_openai', name: 'Azure OpenAI', icon: Icons.cloud, isEnabled: false),
    AIProvider(id: 'azure_ai', name: 'Azure AI', icon: Icons.cloud_circle, isEnabled: false),
    AIProvider(id: 'ollama_cloud', name: 'Ollama Cloud', icon: Icons.cloud_upload, isEnabled: false),
    AIProvider(id: 'vllm', name: 'vLLM', icon: Icons.model_training, isEnabled: false),
    AIProvider(id: 'xinference', name: 'Xorbits Inference', icon: Icons.api, isEnabled: false),
  ];

  AIProvider? _selectedProvider;

  AIProviderState() {
    _selectedProvider = _providers.firstWhere((p) => p.isEnabled);
  }

  List<AIProvider> get providers => _providers;
  List<AIProvider> get enabledProviders => _providers.where((p) => p.isEnabled).toList();
  List<AIProvider> get disabledProviders => _providers.where((p) => !p.isEnabled).toList();
  AIProvider? get selectedProvider => _selectedProvider;

  void selectProvider(AIProvider provider) {
    _selectedProvider = provider;
    notifyListeners();
  }

  void toggleProvider(AIProvider provider) {
    provider.isEnabled = !provider.isEnabled;
    // If we are disabling the currently selected provider, select another one
    if (!provider.isEnabled && _selectedProvider == provider) {
      _selectedProvider = enabledProviders.isNotEmpty ? enabledProviders.first : null;
    }
    // If we are enabling a provider and none is selected, select it
    _selectedProvider ??= provider;
    notifyListeners();
  }
}