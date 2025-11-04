import 'package:get/get.dart';
import 'package:desktop/model/ai_provider_model.dart';
import 'package:desktop/service/ai_box_api_service.dart';
import 'package:logging/logging.dart';

final _log = Logger('AIProviderController');

class AIProviderController extends GetxController {
  final AiBoxApiService _apiService = AiBoxApiService();
  
  // 状态变量
  var providers = <AiProvider>[].obs;
  var selectedProvider = Rx<AiProvider?>(null);
  var isLoading = false.obs;
  var isRefreshing = false.obs;
  var error = Rx<String?>(null);
  
  @override
  void onInit() {
    super.onInit();
    fetchProviders();
  }
  
  @override
  void onClose() {
    _apiService.dispose();
    super.onClose();
  }
  
  // 获取启用的提供商
  List<AiProvider> get enabledProviders => 
      providers.where((p) => p.enabled).toList();
  
  // 获取禁用的提供商
  List<AiProvider> get disabledProviders => 
      providers.where((p) => !p.enabled).toList();
  
  void clearError() {
    error.value = null;
  }
  
  void _setLoading(bool loading) {
    isLoading.value = loading;
  }
  
  void _setRefreshing(bool refreshing) {
    isRefreshing.value = refreshing;
  }
  
  void _setError(String? errorMsg) {
    error.value = errorMsg;
  }
  
  // 获取提供商列表
  Future<void> fetchProviders() async {
    _setLoading(true);
    _setError(null);
    
    try {
      final response = await _apiService.listProviders(
        page: 1,
        size: 100,
        enabledOnly: false,
      );
      providers.assignAll(response.providers);
      
      // 设置默认选中的提供商
      if (providers.isNotEmpty && selectedProvider.value == null) {
        selectedProvider.value = providers.first;
      }
    } catch (e) {
      if (e is AiBoxApiException) {
        _setError('获取提供商失败: ${e.message}');
      } else {
        _setError('获取提供商失败: ${e.toString()}');
      }
    } finally {
      _setLoading(false);
    }
  }
  
  // 刷新提供商列表
  Future<void> refreshProviders() async {
    _setRefreshing(true);
    await fetchProviders();
    _setRefreshing(false);
  }
  
  // 选择提供商
  void selectProvider(String id) {
    final provider = providers.firstWhere(
      (p) => p.id == id,
      orElse: () => throw ArgumentError('未找到ID为 $id 的提供商'),
    );
    selectedProvider.value = provider;
  }
  
  // 切换提供商状态
  Future<void> toggleProvider(String id, bool enabled) async {
    try {
      final request = UpdateProviderRequest(id: id, enabled: enabled);
      await updateProvider(id, request);
    } catch (e) {
      _setError('切换提供商状态失败: $e');
      rethrow;
    }
  }
  
  // 更新提供商
  Future<void> updateProvider(String id, UpdateProviderRequest request) async {
    _setLoading(true);
    _setError(null);
    _log.info('尝试更新提供商 $id，请求: ${request.toJson()}');
    
    try {
      // 发送更新请求
      final updatedProvider = await _apiService.updateProvider(request);
      _log.info('收到更新响应: ${updatedProvider.toJson()}');
      
      // 重新获取提供商以验证更改
      final verifiedProvider = await _apiService.getProvider(id);
      _log.info('收到验证响应: ${verifiedProvider.toJson()}');
      
      // 验证后端是否实际保存了更改
      if (request.config != null) {
        // 注意：后端出于安全原因不返回API密钥，因此我们只验证其他字段
        if (verifiedProvider.config.endpoint != request.config!.endpoint ||
            verifiedProvider.config.proxyUrl != request.config!.proxyUrl ||
            verifiedProvider.config.timeout != request.config!.timeout ||
            verifiedProvider.config.maxRetries != request.config!.maxRetries) {
          final errorMsg = '''
后端验证失败！
  - 发送: ${request.toJson()}
  - 收到: ${verifiedProvider.toJson()}
  - 注意：后端不返回API密钥
''';
          _log.warning(errorMsg);
          throw AiBoxApiException(errorMsg, 0);
        }
        _log.info('配置更新验证成功（不验证API密钥）');
      }
      
      // 更新本地状态
      final index = providers.indexWhere((p) => p.id == id);
      if (index != -1) {
        providers[index] = verifiedProvider;
        
        if (selectedProvider.value?.id == id) {
          selectedProvider.value = verifiedProvider;
        }
      }
      
      _log.info('提供商 $id 更新成功');
    } catch (e, s) {
      _log.severe('更新提供商 $id 失败', e, s);
      _setError('更新提供商失败: $e');
      rethrow;
    } finally {
      _setLoading(false);
    }
  }
  
  // 更新提供商配置
  Future<void> updateProviderConfig(String id, ProviderConfig config) async {
    final request = UpdateProviderRequest(id: id, config: config);
    await updateProvider(id, request);
  }
  
  // 测试提供商连接
  Future<TestProviderResponse> testProviderConnection(String id) async {
    _setError(null);
    
    try {
      return await _apiService.testProvider(id);
    } catch (e) {
      _setError('测试提供商连接失败: $e');
      rethrow;
    }
  }
  
  // 获取提供商信息
  AiProvider? getProviderInfo(String id) {
    try {
      return providers.firstWhere((p) => p.id == id);
    } catch (e) {
      return null;
    }
  }
}