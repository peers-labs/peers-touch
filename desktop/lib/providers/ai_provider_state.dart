import 'package:flutter/foundation.dart';
import '../models/ai_provider_model.dart';
import '../services/ai_box_api_service.dart';
import 'ai_provider_state_interface.dart';

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
  List<AiProvider> get enabledProviders => _providers.where((p) => p.enabled).toList();

  @override
  List<AiProvider> get disabledProviders => _providers.where((p) => !p.enabled).toList();

  @override
  bool get isLoading => _isLoading;

  @override
  String? get error => _error;

  @override
  AiProvider? get selectedProvider => _selectedProvider;

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
      _setError('加载提供商失败: $e');
    } finally {
      _setLoading(false);
    }
  }

  @override
  Future<void> refreshProviders() async {
    await loadProviders();
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
    
    try {
      final updatedProvider = await _apiService.updateProvider(request);
      
      final index = _providers.indexWhere((p) => p.id == id);
      if (index != -1) {
        _providers[index] = updatedProvider;
        
        // 如果更新的是当前选中的提供商，也要更新选中状态
        if (_selectedProvider?.id == id) {
          _selectedProvider = updatedProvider;
        }
        
        notifyListeners();
      }
    } catch (e) {
      _setError('更新提供商失败: $e');
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
        final request = UpdateProviderRequest(id: id);
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
    _error = error;
    if (error != null) {
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