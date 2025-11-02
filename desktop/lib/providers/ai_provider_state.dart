import 'package:flutter/material.dart';
import 'package:desktop/models/ai_provider.dart';
import 'package:desktop/services/backend_client.dart';
import 'package:desktop/providers/ai_provider_state_interface.dart';

class AIProviderState extends AIProviderStateInterface {
  final BackendClient _backendClient;
  List<AIProvider> _providers = [];
  List<ProviderInfo> _providerInfos = [];
  AIProvider? _selectedProvider;
  bool _isLoading = false;
  String? _error;

  AIProviderState({BackendClient? backendClient}) 
      : _backendClient = backendClient ?? BackendClient() {
    _loadProviders();
  }

  List<AIProvider> get providers => _providers;
  List<ProviderInfo> get providerInfos => _providerInfos;
  List<AIProvider> get enabledProviders => _providers.where((p) => p.isEnabled).toList();
  List<AIProvider> get disabledProviders => _providers.where((p) => !p.isEnabled).toList();
  AIProvider? get selectedProvider => _selectedProvider;
  bool get isLoading => _isLoading;
  String? get error => _error;

  Future<void> _loadProviders() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _backendClient.listProviderInfos();
      final providersData = response['providers'] as List<dynamic>?;
      
      if (providersData != null) {
        _providerInfos = providersData
            .map((data) => ProviderInfo.fromJson(data as Map<String, dynamic>))
            .toList();
        
        _providers = _providerInfos
            .map((info) => AIProvider.fromProviderInfo(info))
            .toList();
        
        // Select the first enabled provider if none is selected
        if (_selectedProvider == null && enabledProviders.isNotEmpty) {
          _selectedProvider = enabledProviders.first;
        }
      }
    } catch (e) {
      _error = 'Failed to load providers: $e';
      // Fallback to mock data if backend is not available
      _loadMockProviders();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  void _loadMockProviders() {
    // 提供默认的provider列表，即使在网络错误时也能显示基本界面
    _providers = [
      AIProvider(id: 'openai', name: 'OpenAI', description: 'OpenAI is a global leader in artificial intelligence research, with models like GPT-4.', icon: Icons.cloud_queue, isEnabled: true),
      AIProvider(id: 'ollama', name: 'Ollama', description: 'Ollama provides models that cover a wide range of fields, including code generation.', icon: Icons.memory, isEnabled: true),
      AIProvider(id: 'comfyui', name: 'ComfyUI', description: 'A powerful open-source workflow engine for generating images, videos, and audio.', icon: Icons.widgets, isEnabled: true),
      AIProvider(id: 'google', name: 'Google', description: 'Google offers a variety of advanced AI models, including Gemini.', icon: Icons.search, isEnabled: true),
      AIProvider(id: 'anthropic', name: 'Anthropic', description: 'Anthropic provides advanced AI models like Claude.', icon: Icons.psychology, isEnabled: true),
      AIProvider(id: 'moonshot', name: 'Moonshot', description: 'Moonshot AI offers powerful language models.', icon: Icons.rocket_launch, isEnabled: true),
      AIProvider(id: 'fal', name: 'Fal', description: 'Fal.ai provides fast and scalable AI model inference.', icon: Icons.flash_on, isEnabled: true),
      AIProvider(id: 'bytedance-kimi2', name: 'bytedance-kimi2', description: 'Kimi is a large language model from Bytedance.', icon: Icons.android, isEnabled: false),
      AIProvider(id: 'azure_openai', name: 'Azure OpenAI', description: 'Azure offers a variety of advanced AI models, including GPT-3.5 and the latest.', icon: Icons.cloud, isEnabled: false),
      AIProvider(id: 'azure_ai', name: 'Azure AI', description: 'Azure offers a variety of advanced AI models, including GPT-3.5 and the latest.', icon: Icons.cloud_circle, isEnabled: false),
      AIProvider(id: 'ollama_cloud', name: 'Ollama Cloud', description: 'Ollama Cloud offers officially hosted inference services, providing out-of-the-box support.', icon: Icons.cloud_upload, isEnabled: false),
      AIProvider(id: 'vllm', name: 'vLLM', description: 'vLLM is a fast and easy-to-use library for LLM inference and serving.', icon: Icons.model_training, isEnabled: false),
      AIProvider(id: 'xinference', name: 'Xorbits Inference', description: 'A powerful and versatile library for running various AI models.', icon: Icons.api, isEnabled: false),
    ];
    
    // 创建对应的ProviderInfo对象，状态设为unknown（因为网络错误无法获取真实状态）
    _providerInfos = _providers.map((provider) => ProviderInfo(
      name: provider.id,
      displayName: provider.name,
      enabled: provider.isEnabled,
      config: {},
      models: [],
      status: 'unknown', // 网络错误时状态为unknown
    )).toList();
    
    if (_selectedProvider == null && enabledProviders.isNotEmpty) {
      _selectedProvider = enabledProviders.first;
    }
  }

  Future<void> refreshProviders() async {
    await _loadProviders();
  }

  void selectProvider(AIProvider provider) {
    _selectedProvider = provider;
    notifyListeners();
  }

  Future<void> toggleProvider(AIProvider provider) async {
    try {
      final newEnabledState = !provider.isEnabled;
      await _backendClient.setProviderEnabled(provider.id, newEnabledState);
      
      provider.isEnabled = newEnabledState;
      
      // Update the corresponding ProviderInfo
      final providerInfoIndex = _providerInfos.indexWhere((info) => info.name == provider.id);
      if (providerInfoIndex != -1) {
        _providerInfos[providerInfoIndex] = _providerInfos[providerInfoIndex].copyWith(enabled: newEnabledState);
      }
      
      // If we are disabling the currently selected provider, select another one
      if (!provider.isEnabled && _selectedProvider == provider) {
        _selectedProvider = enabledProviders.isNotEmpty ? enabledProviders.first : null;
      }
      // If we are enabling a provider and none is selected, select it
      _selectedProvider ??= provider;
      
      notifyListeners();
    } catch (e) {
      _error = 'Failed to toggle provider: $e';
      notifyListeners();
    }
  }

  Future<void> updateProviderConfig(String providerName, Map<String, dynamic> config) async {
    try {
      await _backendClient.updateProviderConfig(providerName, config);
      
      // Update local provider info
      final providerInfoIndex = _providerInfos.indexWhere((info) => info.name == providerName);
      if (providerInfoIndex != -1) {
        _providerInfos[providerInfoIndex] = _providerInfos[providerInfoIndex].copyWith(config: config);
      }
      
      notifyListeners();
    } catch (e) {
      _error = 'Failed to update provider config: $e';
      notifyListeners();
    }
  }

  Future<bool> testProviderConnection(String providerName) async {
    try {
      await _backendClient.testProviderConnection(providerName);
      
      // Update provider status to connected
      final providerInfoIndex = _providerInfos.indexWhere((info) => info.name == providerName);
      if (providerInfoIndex != -1) {
        _providerInfos[providerInfoIndex] = _providerInfos[providerInfoIndex].copyWith(
          status: 'connected',
          error: null,
        );
      }
      
      notifyListeners();
      return true;
    } catch (e) {
      // Update provider status to error
      final providerInfoIndex = _providerInfos.indexWhere((info) => info.name == providerName);
      if (providerInfoIndex != -1) {
        _providerInfos[providerInfoIndex] = _providerInfos[providerInfoIndex].copyWith(
          status: 'error',
          error: e.toString(),
        );
      }
      
      _error = 'Connection test failed: $e';
      notifyListeners();
      return false;
    }
  }

  ProviderInfo? getProviderInfo(String providerName) {
    try {
      return _providerInfos.firstWhere((info) => info.name == providerName);
    } catch (e) {
      return null;
    }
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }
}