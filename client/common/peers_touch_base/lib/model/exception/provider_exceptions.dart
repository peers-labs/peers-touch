/// Provider领域异常定义
/// 用于处理Provider相关的业务异常

/// Provider基础异常类
abstract class ProviderException implements Exception {
  final String message;
  final String? providerId;
  
  ProviderException(this.message, {this.providerId});
  
  @override
  String toString() {
    if (providerId != null) {
      return 'ProviderException[$providerId]: $message';
    }
    return 'ProviderException: $message';
  }
}

/// 配置异常 - 当Provider配置无效时抛出
class InvalidProviderConfigException extends ProviderException {
  InvalidProviderConfigException(String message, {String? providerId}) 
    : super(message, providerId: providerId);
}

/// API密钥异常 - 当API密钥无效或缺失时抛出
class InvalidApiKeyException extends ProviderException {
  InvalidApiKeyException(String message, {String? providerId}) 
    : super(message, providerId: providerId);
}

/// 模型异常 - 当模型配置无效时抛出
class InvalidModelsException extends ProviderException {
  InvalidModelsException(String message, {String? providerId}) 
    : super(message, providerId: providerId);
}

/// 客户端创建异常 - 当无法创建客户端实例时抛出
class ClientCreationException extends ProviderException {
  final dynamic originalError;
  
  ClientCreationException(String message, {String? providerId, this.originalError}) 
    : super(message, providerId: providerId);
    
  @override
  String toString() {
    final baseMessage = super.toString();
    if (originalError != null) {
      return '$baseMessage (原始错误: $originalError)';
    }
    return baseMessage;
  }
}

/// 不支持的操作异常 - 当尝试执行不支持的操作时抛出
class UnsupportedOperationException extends ProviderException {
  UnsupportedOperationException(String message, {String? providerId}) 
    : super(message, providerId: providerId);
}