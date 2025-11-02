import 'package:flutter/material.dart';
import 'package:desktop/models/ai_provider.dart';
import 'package:desktop/services/mock_backend_client.dart';
import 'package:desktop/providers/ai_provider_state_interface.dart';

class MockAIProviderState extends AIProviderStateInterface {
  final MockBackendClient _mockClient = MockBackendClient();
  List<AIProvider> _providers = [];
  List<ProviderInfo> _providerInfos = [];
  AIProvider? _selectedProvider;
  bool _isLoading = false;
  String? _error;

  MockAIProviderState() {
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
      final response = await _mockClient.listProviderInfos();
      final providersData = response['providers'] as List<dynamic>?;
      
      if (providersData != null) {
        _providerInfos = providersData
            .map((data) => ProviderInfo.fromJson(data as Map<String, dynamic>))
            .toList();
        
        _providers = _providerInfos
            .map((info) => AIProvider.fromProviderInfo(info))
            .toList();
        
        // Select the first provider if none is selected
        if (_selectedProvider == null && _providers.isNotEmpty) {
          _selectedProvider = _providers.first;
        }
      }
    } catch (e) {
      _error = 'Failed to load providers: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  void selectProvider(AIProvider provider) {
    _selectedProvider = provider;
    notifyListeners();
  }

  Future<void> toggleProvider(AIProvider provider) async {
    try {
      final response = await _mockClient.toggleProvider(provider.id);
      if (response['success'] == true) {
        // Update local state
        final index = _providers.indexWhere((p) => p.id == provider.id);
        if (index != -1) {
          _providers[index] = _providers[index].copyWith(
            isEnabled: !_providers[index].isEnabled,
          );
          
          // Update provider info as well
          final infoIndex = _providerInfos.indexWhere((p) => p.name == provider.id);
          if (infoIndex != -1) {
            _providerInfos[infoIndex] = _providerInfos[infoIndex].copyWith(
              enabled: !_providerInfos[infoIndex].enabled,
            );
          }
          
          notifyListeners();
        }
      } else {
        _error = response['error'] ?? 'Failed to toggle provider';
        notifyListeners();
      }
    } catch (e) {
      _error = 'Failed to toggle provider: $e';
      notifyListeners();
    }
  }

  Future<void> updateProviderConfig(String providerId, Map<String, dynamic> config) async {
    try {
      final response = await _mockClient.updateProviderConfig(providerId, config);
      if (response['success'] == true) {
        // Update local state
        final infoIndex = _providerInfos.indexWhere((p) => p.name == providerId);
        if (infoIndex != -1) {
          final updatedConfig = Map<String, dynamic>.from(_providerInfos[infoIndex].config);
          updatedConfig.addAll(config);
          
          _providerInfos[infoIndex] = _providerInfos[infoIndex].copyWith(
            config: updatedConfig,
          );
          
          // Update provider as well
          final providerIndex = _providers.indexWhere((p) => p.id == providerId);
          if (providerIndex != -1) {
            _providers[providerIndex] = AIProvider.fromProviderInfo(_providerInfos[infoIndex]);
          }
          
          notifyListeners();
        }
      } else {
        _error = response['error'] ?? 'Failed to update provider config';
        notifyListeners();
      }
    } catch (e) {
      _error = 'Failed to update provider config: $e';
      notifyListeners();
    }
  }

  Future<bool> testProviderConnection(String providerId) async {
    try {
      final response = await _mockClient.testProviderConnection(providerId);
      return response['success'] == true;
    } catch (e) {
      _error = 'Failed to test connection: $e';
      notifyListeners();
      return false;
    }
  }

  ProviderInfo? getProviderInfo(String providerId) {
    try {
      return _providerInfos.firstWhere((info) => info.name == providerId);
    } catch (e) {
      return null;
    }
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }

  Future<void> refreshProviders() async {
    await _loadProviders();
  }
}