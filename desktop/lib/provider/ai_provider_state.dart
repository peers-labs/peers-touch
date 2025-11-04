import 'package:desktop/model/ai_provider_model.dart';
import 'package:desktop/service/ai_box_api_service.dart';
import 'package:flutter/foundation.dart';
import 'package:logging/logging.dart';

import 'ai_provider_state_interface.dart';

final _log = Logger('AIProviderState');

class AIProviderState extends ChangeNotifier implements AIProviderStateInterface {
  final AiBoxApiService _apiService;

  List<AiProvider> _providers = [];
  bool _isLoading = false;
  String? _error;
  AiProvider? _selectedProvider;

  AIProviderState({AiBoxApiService? apiService})
      : _apiService = apiService ?? AiBoxApiService();

  @override
  List<AiProvider> get providers => _providers;

  @override
  List<AiProvider> get enabledProviders =>
      _providers.where((p) => p.enabled).toList();

  @override
  List<AiProvider> get disabledProviders =>
      _providers.where((p) => !p.enabled).toList();

  @override
  bool get isLoading => _isLoading;

  @override
  String? get error => _error;

  @override
  AiProvider? get selectedProvider => _selectedProvider;

  bool _isRefreshing = false;

  @override
  bool get isRefreshing => _isRefreshing;

  @override
  Future<void> loadProviders() async {
    _setLoading(true);
    _setError(null);

    try {
      final response = await _apiService.listProviders(
        page: 1,
        size: 100, // 获取所有提供商
        enabledOnly: false,
      );

      _providers = response.providers;

      // 如果没有选中的提供商，选择第一个启用的提供商
      if (_selectedProvider == null && _providers.isNotEmpty) {
        final enabledProvider = _providers.firstWhere(
          (p) => p.enabled,
          orElse: () => _providers.first,
        );
        _selectedProvider = enabledProvider;
      }

      notifyListeners();
    } catch (e) {
      if (e is AiBoxApiException) {
        _setError('加载提供商失败: ${e.message}');
      } else {
        _setError('加载提供商失败: ${e.toString()}');
      }
    } finally {
      _setLoading(false);
    }
  }

  @override
  Future<void> refreshProviders() async {
    _isRefreshing = true;
    notifyListeners();

    try {
      final response = await _apiService.listProviders(
        page: 1,
        size: 100,
        enabledOnly: false,
      );
      _providers = response.providers;
    } catch (e) {
      if (e is AiBoxApiException) {
        _setError('刷新提供商失败: ${e.message}');
      } else {
        _setError('刷新提供商失败: ${e.toString()}');
      }
    } finally {
      _isRefreshing = false;
      notifyListeners();
    }
  }

  @override
  Future<void> addProvider(CreateProviderRequest request) async {
    _setLoading(true);
    _setError(null);

    try {
      final newProvider = await _apiService.createProvider(request);
      _providers.add(newProvider);
      notifyListeners();
    } catch (e) {
      _setError('添加提供商失败: $e');
      rethrow;
    } finally {
      _setLoading(false);
    }
  }

  @override
  Future<void> updateProvider(String id, UpdateProviderRequest request) async {
    _setLoading(true);
    _setError(null);
    _log.info('Attempting to update provider $id with request: ${request.toJson()}');

    try {
      // Send the update request and log the immediate response.
      final updatedProviderResponse = await _apiService.updateProvider(request);
      _log.info(
          'Received immediate response from updateProvider: ${updatedProviderResponse.toJson()}');

      // Fetch the provider again to get the true, persisted state from the backend.
      final trulyUpdatedProvider = await _apiService.getProvider(id);
      _log.info(
          'Received verification response from getProvider: ${trulyUpdatedProvider.toJson()}');

      // Verify that the backend has actually saved the changes.
      // Note: Backend does not return API key for security reasons, so we only verify other fields
      if (request.config != null) {
        // Only verify non-sensitive fields that should be returned
        if (trulyUpdatedProvider.config.endpoint != request.config!.endpoint ||
            trulyUpdatedProvider.config.proxyUrl != request.config!.proxyUrl ||
            trulyUpdatedProvider.config.timeout != request.config!.timeout ||
            trulyUpdatedProvider.config.maxRetries != request.config!.maxRetries) {
          final errorMsg = '''
Backend verification failed!
  - Sent: ${request.toJson()}
  - Received (non-sensitive fields): {
      "endpoint": "${trulyUpdatedProvider.config.endpoint}",
      "proxy_url": "${trulyUpdatedProvider.config.proxyUrl}",
      "timeout": ${trulyUpdatedProvider.config.timeout},
      "max_retries": ${trulyUpdatedProvider.config.maxRetries}
    }
  - Note: API key is not returned by backend for security reasons
''';
          _log.warning(errorMsg);
          throw AiBoxApiException(errorMsg, 0);
        }
        _log.info('Config update verified successfully (API key not returned for security)');
      }

      // If verification passes, update the local state.
      _log.info('Provider $id update successful and verified.');
      final index = _providers.indexWhere((p) => p.id == id);
      if (index != -1) {
        _providers[index] = trulyUpdatedProvider;

        if (_selectedProvider?.id == id) {
          _selectedProvider = trulyUpdatedProvider;
        }

        notifyListeners();
      }
    } catch (e, s) {
      _log.severe('Failed to update provider $id.', e, s);
      _setError('Failed to update provider: $e');
      rethrow;
    } finally {
      _setLoading(false);
    }
  }

  @override
  Future<void> deleteProvider(String id) async {
    _setLoading(true);
    _setError(null);

    try {
      await _apiService.deleteProvider(id);

      _providers.removeWhere((p) => p.id == id);

      // 如果删除的是当前选中的提供商，清除选中状态
      if (_selectedProvider?.id == id) {
        _selectedProvider = _providers.isNotEmpty ? _providers.first : null;
      }

      notifyListeners();
    } catch (e) {
      _setError('删除提供商失败: $e');
      rethrow;
    } finally {
      _setLoading(false);
    }
  }

  @override
  Future<void> toggleProvider(String id, bool enabled) async {
    try {
      final request = UpdateProviderRequest(
        id: id,
        enabled: enabled,
      );

      await updateProvider(id, request);
    } catch (e) {
      _setError('切换提供商状态失败: $e');
      rethrow;
    }
  }

  @override
  Future<void> updateProviderConfig(String id, ProviderConfig config) async {
    // 这个方法需要后端支持单独更新配置的接口
    // 目前通过 updateProvider 来实现
    try {
      final provider = getProviderInfo(id);
      if (provider != null) {
        final request = UpdateProviderRequest(id: id, config: config);
        await updateProvider(id, request);
      }
    } catch (e) {
      _setError('更新提供商配置失败: $e');
      rethrow;
    }
  }

  @override
  Future<TestProviderResponse> testProviderConnection(String id) async {
    _setError(null);

    try {
      return await _apiService.testProvider(id);
    } catch (e) {
      _setError('测试提供商连接失败: $e');
      rethrow;
    }
  }

  @override
  void selectProvider(String id) {
    final provider = _providers.firstWhere(
      (p) => p.id == id,
      orElse: () => throw ArgumentError('Provider with id $id not found'),
    );

    _selectedProvider = provider;
    notifyListeners();
  }

  @override
  AiProvider? getProviderInfo(String id) {
    try {
      return _providers.firstWhere((p) => p.id == id);
    } catch (e) {
      return null;
    }
  }

  void _setLoading(bool loading) {
    _isLoading = loading;
    notifyListeners();
  }

  void _setError(String? error) {
    if (_error != error) {
      _error = error;
      notifyListeners();
    }
  }

  @override
  void clearError() {
    _setError(null);
  }

  @override
  void dispose() {
    _apiService.dispose();
    super.dispose();
  }
}