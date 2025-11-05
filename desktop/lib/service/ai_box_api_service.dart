import 'dart:convert';
import 'package:peers_touch_desktop/model/ai_provider_model.dart';
import 'package:peers_touch_desktop/core/network/network.dart';
import 'package:logging/logging.dart';

final _log = Logger('AiBoxApiService');

class AiBoxApiService {
  static const String _defaultBaseUrl = 'http://localhost:8080';
  
  final HttpClient _client;
  final Logger _log = Logger('AiBoxApiService');

  AiBoxApiService({HttpClient? client})
      : _client = client ?? NetworkProvider.client;

  /// 获取提供商列表
  Future<ListProvidersResponse> listProviders({
    int page = 1,
    int size = 10,
    bool enabledOnly = false,
  }) async {
    try {
      final response = await _client.get<Map<String, dynamic>>(
        '/ai-box/providers',
        queryParameters: {
          'page': page.toString(),
          'size': size.toString(),
          if (enabledOnly) 'enabled_only': 'true',
        },
        fromJson: (data) => data as Map<String, dynamic>,
      );
      
      return ListProvidersResponse.fromJson(response);
    } on NetworkException catch (e) {
      _log.severe('Network error while listing providers: $e');
      throw AiBoxApiException('Network error: ${e.message}', e.statusCode ?? 0);
    } catch (e) {
      _log.severe('Unexpected error while listing providers: $e');
      throw AiBoxApiException('Unexpected error: $e', 0);
    }
  }

  /// 获取单个提供商
  Future<AiProvider> getProvider(String id) async {
    try {
      final response = await _client.get<Map<String, dynamic>>(
        '/ai-box/provider/get',
        queryParameters: {'id': id},
        fromJson: (data) => data as Map<String, dynamic>,
      );
      
      return AiProvider.fromJson(response);
    } on NetworkException catch (e) {
      _log.severe('Network error while getting provider: $e');
      throw AiBoxApiException('Network error: ${e.message}', e.statusCode ?? 0);
    } catch (e) {
      _log.severe('Unexpected error while getting provider: $e');
      throw AiBoxApiException('Unexpected error: $e', 0);
    }
  }

  /// 创建提供商
  Future<AiProvider> createProvider(CreateProviderRequest request) async {
    try {
      _log.info('Creating provider with data: ${request.toJson()}');
      
      final response = await _client.post<Map<String, dynamic>>(
        '/ai-box/provider/new',
        data: request.toJson(),
        fromJson: (data) => data as Map<String, dynamic>,
      );
      
      return AiProvider.fromJson(response);
    } on NetworkException catch (e) {
      _log.severe('Network error while creating provider: $e');
      throw AiBoxApiException('Network error: ${e.message}', e.statusCode ?? 0);
    } catch (e) {
      _log.severe('Unexpected error while creating provider: $e');
      throw AiBoxApiException('Unexpected error: $e', 0);
    }
  }

  /// 更新提供商
  Future<AiProvider> updateProvider(UpdateProviderRequest request) async {
    try {
      final body = request.toJson();
      _log.info('Updating provider with data: $body');
      
      final response = await _client.post<Map<String, dynamic>>(
        '/ai-box/provider/update',
        data: body,
        fromJson: (data) => data as Map<String, dynamic>,
      );
      
      _log.info('Provider updated successfully');
      return AiProvider.fromJson(response);
    } on NetworkException catch (e) {
      _log.severe('Network error while updating provider: $e');
      throw AiBoxApiException('Network error: ${e.message}', e.statusCode ?? 0);
    } catch (e) {
      _log.severe('Unexpected error while updating provider: $e');
      throw AiBoxApiException('Unexpected error: $e', 0);
    }
  }

  /// 删除提供商
  Future<void> deleteProvider(String id) async {
    try {
      await _client.post<Map<String, dynamic>>(
        '/ai-box/provider/delete',
        data: {'id': id},
        fromJson: (data) => data as Map<String, dynamic>,
      );
      
      _log.info('Provider $id deleted successfully');
    } on NetworkException catch (e) {
      _log.severe('Network error while deleting provider: $e');
      throw AiBoxApiException('Network error: ${e.message}', e.statusCode ?? 0);
    } catch (e) {
      _log.severe('Unexpected error while deleting provider: $e');
      throw AiBoxApiException('Unexpected error: $e', 0);
    }
  }

  /// 测试提供商连接
  Future<TestProviderResponse> testProvider(String id) async {
    try {
      _log.info('Testing provider $id');
      
      final response = await _client.post<Map<String, dynamic>>(
        '/ai-box/provider/test',
        data: {'id': id},
        fromJson: (data) => data as Map<String, dynamic>,
      );
      
      return TestProviderResponse.fromJson(response);
    } on NetworkException catch (e) {
      _log.severe('Network error while testing provider: $e');
      throw AiBoxApiException('Network error: ${e.message}', e.statusCode ?? 0);
    } catch (e) {
      _log.severe('Unexpected error while testing provider: $e');
      throw AiBoxApiException('Unexpected error: $e', 0);
    }
  }

  /// 获取请求头
  Map<String, String> _getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  /// 释放资源
  void dispose() {
    // No need to dispose the global client
  }
}

/// AI Box API 异常类
class AiBoxApiException implements Exception {
  final String message;
  final int statusCode;

  AiBoxApiException(dynamic message, this.statusCode)
      : message = _formatMessage(message);

  static String _formatMessage(dynamic message) {
    if (message is String) {
      return message;
    } else if (message is Map || message is List) {
      return json.encode(message);
    } else {
      return message.toString();
    }
  }

  @override
  String toString() => 'AiBoxApiException: $message (Status: $statusCode)';
}