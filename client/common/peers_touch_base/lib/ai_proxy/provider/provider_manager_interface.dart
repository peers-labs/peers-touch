import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';

/// Provider管理器接口，定义了Provider的增删改查等操作
/// 这是ai_proxy模块的内部接口，不应被外部直接引用
abstract class IProviderManager {
  /// 创建一个新的Provider对象（仅在内存中，不持久化）
  Provider newProvider(ProviderType type, String url, String apiKey);

  /// 创建Provider并保存
  Future<Provider> createProvider(Provider provider);

  /// 根据ID获取Provider
  Future<Provider?> getProvider(String id);

  /// 获取所有Provider
  Future<List<Provider>> listProviders();

  /// 更新Provider
  Future<Provider> updateProvider(Provider provider);

  /// 删除Provider
  Future<void> deleteProvider(String id);

  /// 获取默认Provider
  Future<Provider?> getDefaultProvider();

  /// 设置默认Provider
  Future<void> setDefaultProvider(String id);

  /// 获取当前Provider
  Future<Provider?> getCurrentProvider();

  /// 设置当前Provider
  Future<void> setCurrentProvider(String id);

  /// 获取会话级当前Provider
  Future<Provider?> getCurrentProviderForSession(String sessionId);

  /// 设置会话级当前Provider
  Future<void> setCurrentProviderForSession(String sessionId, String id);
}
