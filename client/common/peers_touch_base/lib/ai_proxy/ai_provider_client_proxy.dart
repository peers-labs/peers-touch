import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:peers_touch_base/ai_proxy/interfaces/ai_provider_interface.dart';
import 'package:peers_touch_base/ai_proxy/managers/ai_provider_manager.dart';
import 'package:peers_touch_base/ai_proxy/managers/provider_config_manager.dart';
import 'package:peers_touch_base/ai_proxy/models/chat_models.dart';
import 'package:peers_touch_base/ai_proxy/providers/deepseek_client.dart';
import 'package:peers_touch_base/ai_proxy/providers/ollama_client.dart';
import 'package:peers_touch_base/ai_proxy/providers/openai_client.dart';

import 'models/provider_config.dart';

/// A proxy client for interacting with AI providers.
///
/// This class serves as a singleton entry point for the application to interact
/// with various AI providers. It abstracts the underlying complexity of managing
/// provider configurations, runtime instances, and API requests.
class AIProviderClientProxy {
  /// The singleton instance of the proxy.
  static final AIProviderClientProxy instance = AIProviderClientProxy._();

  AIProviderClientProxy._();

  // Internal managers for configuration and runtime provider instances.
  final ProviderConfigManager _configManager = ProviderConfigManager();
  final AIProviderManager _providerManager = AIProviderManager();

  /// Provides access to the configuration manager for CRUD operations on providers.
  ProviderConfigManager get configManager => _configManager;

  // --- Reactive State Properties ---

  /// A notifier for the list of currently available (and enabled) providers.
  /// UI components can listen to this to display the list of providers.
  final ValueNotifier<List<ProviderConfig>> availableProviders = ValueNotifier([]);

  /// A notifier for the connection status of each provider.
  /// The key is the provider ID, and the value is true if connected, false otherwise.
  final ValueNotifier<Map<String, bool>> connectionStates = ValueNotifier({});

  /// A notifier for the list of models available for each provider.
  /// The key is the provider ID, and the value is a list of [ModelInfo].
  final ValueNotifier<Map<String, List<ModelInfo>>> models = ValueNotifier({});

  /// Initializes the proxy.
  ///
  /// This method should be called once at application startup. It loads the
  /// provider configurations from the specified [configPath] and initializes
  /// the providers.
  Future<void> initialize({String configPath = 'assets/ai_provider.yml'}) async {
    await _configManager.loadFromFile(configPath);
    await reloadAllProviders();
  }

  /// Reloads all providers from the configuration manager.
  ///
  /// This is useful when provider configurations have been added, updated, or deleted.
  /// It clears all existing provider instances and re-initializes them based on
  /// the latest configuration.
  Future<void> reloadAllProviders() async {
    _providerManager.closeAll();
    final configs = _configManager.listProviderConfigs().where((c) => c.enabled).toList();

    // Register providers from the loaded configs
    for (final config in configs) {
      // This part needs to be updated to use a factory or switch-case
      // to instantiate the correct provider client based on config.type
            final provider = _createProviderFromConfig(config);
      if (provider != null) {
        _providerManager.registerProvider(config.id, provider);
      }
    }

    availableProviders.value = configs;
    await _checkAllConnections();
  }

  /// Performs a non-streaming chat completion request.
  Future<ChatCompletionResponse> chat({
    required String providerId,
    required ChatCompletionRequest request,
  }) {
    return _providerManager.chatCompletionWithProvider(providerId, request);
  }

  /// Performs a streaming chat completion request.
  Stream<ChatCompletionResponse> chatStream({
    required String providerId,
    required ChatCompletionRequest request,
  }) {
    return _providerManager.chatCompletionStreamWithProvider(providerId, request);
  }

  /// Fetches and updates the list of models for a specific provider.
  Future<void> listModelsForProvider(String providerId) async {
    try {
      final provider = _providerManager.getProvider(providerId);
      if (provider == null) return;

      final modelList = await provider.listModels();
      final currentModels = Map<String, List<ModelInfo>>.from(models.value);
      currentModels[providerId] = modelList;
      models.value = currentModels;
    } catch (e) {
      // Handle error, maybe update a state to show the error
    }
  }

  /// Checks the connection status of all enabled providers.
  Future<void> _checkAllConnections() async {
    final statuses = <String, bool>{};
    for (final config in availableProviders.value) {
      final provider = _providerManager.getProvider(config.id);
      if (provider != null) {
        statuses[config.id] = await provider.checkConnection();
      }
    }
    connectionStates.value = statuses;
  }

  /// Disposes of all resources and closes connections.
  void dispose() {
    _providerManager.closeAll();
    availableProviders.dispose();
    connectionStates.dispose();
    models.dispose();
  }

  /// Creates an [AIProvider] instance from a [ProviderConfig].
  AIProvider? _createProviderFromConfig(ProviderConfig config) {
    switch (config.type) {
      case AIProviderType.openai:
        return OpenAIClient(config);
      case AIProviderType.ollama:
        return OllamaClient(config);
      case AIProviderType.deepseek:
        return DeepSeekClient(config);
      // Add other provider types here
      default:
        // Log or handle unsupported provider types
        return null;
    }
  }
}