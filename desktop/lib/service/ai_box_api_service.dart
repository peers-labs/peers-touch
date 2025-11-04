import 'dart:convert';
import 'package:desktop/model/ai_provider_model.dart';
import 'package:http/http.dart' as http;
import 'package:logging/logging.dart';

final _log = Logger('AiBoxApiService');

class AiBoxApiService {
  static const String _baseUrl = 'http://localhost:8080'; // 默认本地服务器地址
  static const Duration _timeout = Duration(seconds: 30);

  final http.Client _client;
  final String baseUrl;

  AiBoxApiService({
    http.Client? client,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        baseUrl = baseUrl ?? _baseUrl;

  /// 获取提供商列表
  Future<ListProvidersResponse> listProviders({
    int page = 1,
    int size = 10,
    bool enabledOnly = false,
  }) async {
    try {
      final uri = Uri.parse('$baseUrl/ai-box/providers').replace(
        queryParameters: {
          'page': page.toString(),
          'size': size.toString(),
          if (enabledOnly) 'enabled_only': 'true',
        },
      );

      final response = await _client
          .get(
            uri,
            headers: _getHeaders(),
          )
          .timeout(_timeout);

      if (response.statusCode == 200) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        return ListProvidersResponse.fromJson(data);
      } else {
        throw AiBoxApiException(
          'Failed to list providers: ${response.statusCode}',
          response.statusCode,
        );
      }
    } catch (e) {
      if (e is AiBoxApiException) rethrow;
      throw AiBoxApiException('Network error: $e', 0);
    }
  }

  /// 获取单个提供商
  Future<AiProvider> getProvider(String id) async {
    try {
      final uri = Uri.parse('$baseUrl/ai-box/provider/get').replace(
        queryParameters: {'id': id},
      );

      final response = await _client
          .get(
            uri,
            headers: _getHeaders(),
          )
          .timeout(_timeout);

      if (response.statusCode == 200) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        return AiProvider.fromJson(data);
      } else {
        throw AiBoxApiException(
          'Failed to get provider: ${response.statusCode}',
          response.statusCode,
        );
      }
    } catch (e) {
      if (e is AiBoxApiException) rethrow;
      throw AiBoxApiException('Network error: $e', 0);
    }
  }

  /// 创建提供商
  Future<AiProvider> createProvider(CreateProviderRequest request) async {
    try {
      final uri = Uri.parse('$baseUrl/ai-box/provider/new');

      final response = await _client
          .post(
            uri,
            headers: _getHeaders(),
            body: json.encode(request.toJson()),
          )
          .timeout(_timeout);

      if (response.statusCode == 200) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        return AiProvider.fromJson(data);
      } else {
        throw AiBoxApiException(
          'Failed to create provider: ${response.statusCode}',
          response.statusCode,
        );
      }
    } catch (e) {
      if (e is AiBoxApiException) rethrow;
      throw AiBoxApiException('Network error: $e', 0);
    }
  }

  /// 更新提供商
  Future<AiProvider> updateProvider(UpdateProviderRequest request) async {
    try {
      final uri = Uri.parse('$baseUrl/ai-box/provider/update');
      final body = json.encode(request.toJson());

      _log.info('Sending POST request to $uri');
      _log.info('Request body: $body');

      final response = await _client
          .post(
            uri,
            headers: _getHeaders(),
            body: body,
          )
          .timeout(_timeout);

      _log.info('Response status: ${response.statusCode}');
      _log.info('Response body: ${response.body}');

      if (response.statusCode == 200) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        return AiProvider.fromJson(data);
      } else {
        _log.severe(
            'Failed to update provider. Status: ${response.statusCode}, Body: ${response.body}');
        throw AiBoxApiException(
          'Failed to update provider: ${response.statusCode}',
          response.statusCode,
        );
      }
    } catch (e) {
      if (e is AiBoxApiException) {
        rethrow;
      }
      _log.severe('Network error while updating provider: $e');
      throw AiBoxApiException('Network error: $e', 0);
    }
  }

  /// 删除提供商
  Future<void> deleteProvider(String id) async {
    try {
      final uri = Uri.parse('$baseUrl/ai-box/provider/delete');

      final response = await _client
          .post(
            uri,
            headers: _getHeaders(),
            body: json.encode({'id': id}),
          )
          .timeout(_timeout);

      if (response.statusCode != 200) {
        throw AiBoxApiException(
          'Failed to delete provider: ${response.statusCode}',
          response.statusCode,
        );
      }
    } catch (e) {
      if (e is AiBoxApiException) rethrow;
      throw AiBoxApiException('Network error: $e', 0);
    }
  }

  /// 测试提供商连接
  Future<TestProviderResponse> testProvider(String id) async {
    try {
      final uri = Uri.parse('$baseUrl/ai-box/provider/test');

      final response = await _client
          .post(
            uri,
            headers: _getHeaders(),
            body: json.encode({'id': id}),
          )
          .timeout(_timeout);

      if (response.statusCode == 200) {
        final data = json.decode(response.body) as Map<String, dynamic>;
        return TestProviderResponse.fromJson(data);
      } else {
        throw AiBoxApiException(
          'Failed to test provider: ${response.statusCode}',
          response.statusCode,
        );
      }
    } catch (e) {
      if (e is AiBoxApiException) rethrow;
      throw AiBoxApiException('Network error: $e', 0);
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
    _client.close();
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