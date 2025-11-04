import 'package:desktop/core/network/network.dart';

class BackendConfig {
  // TODO: make this configurable via settings or env.
  static const String defaultBaseUrl = 'http://127.0.0.1:8080';
}

class BackendClient {
  final String baseUrl;
  final HttpClient _client;

  BackendClient({String? baseUrl, HttpClient? client})
      : baseUrl = baseUrl ?? BackendConfig.defaultBaseUrl,
        _client = client ?? NetworkProvider.client;

  Future<Map<String, dynamic>> getJson(String path,
      {Map<String, String>? query}) async {
    try {
      final response = await _client.get<Map<String, dynamic>>(
        path,
        queryParameters: query,
        fromJson: (data) => data as Map<String, dynamic>,
      );
      return response;
    } on NetworkException catch (e) {
      throw Exception('GET $path failed: ${e.message}');
    } catch (e) {
      throw Exception('GET $path failed: $e');
    }
  }

  Future<String> getRaw(String path, {Map<String, String>? query}) async {
    try {
      final response = await _client.get<String>(
        path,
        queryParameters: query,
        fromJson: (data) => data,
      );
      return response;
    } on NetworkException catch (e) {
      throw Exception('GET $path failed: ${e.message}');
    } catch (e) {
      throw Exception('GET $path failed: $e');
    }
  }

  BackendClient withBaseUrl(String newBaseUrl) {
    return BackendClient(baseUrl: newBaseUrl, client: _client);
  }

  // Station APIs
  Future<Map<String, dynamic>> listPhotos({String? album}) async {
    return getJson('/station/photo/list', query: {
      if (album != null && album.isNotEmpty) 'album': album,
    });
  }

  Future<String> getPhoto({required String album, required String filename}) {
    return getRaw('/station/photo/get', query: {
      'album': album,
      'filename': filename,
    });
  }

  // Manage APIs
  Future<Map<String, dynamic>> ping() async {
    return getJson('/ping');
  }

  Future<String> health() async {
    return getRaw('/health');
  }

  // Bootstrap APIs
  Future<Map<String, dynamic>> listBootstrapPeers({int no = 1, int size = 20}) async {
    return getJson('/sub-bootstrap/list-peers', query: {
      'no': '$no',
      'size': '$size',
    });
  }

  // AI-Box APIs
  
  // Provider management
  Future<Map<String, dynamic>> listProviders() async {
    return getJson('/sub-ai-box/providers');
  }

  Future<Map<String, dynamic>> listProviderInfos() async {
    return getJson('/sub-ai-box/providers/info');
  }

  Future<Map<String, dynamic>> getProviderInfo(String providerName) async {
    return getJson('/sub-ai-box/providers/$providerName');
  }

  Future<Map<String, dynamic>> updateProviderConfig(String providerName, Map<String, dynamic> config) async {
    try {
      final response = await _client.put<Map<String, dynamic>>(
        '/sub-ai-box/providers/$providerName/config',
        data: config,
        fromJson: (data) => data as Map<String, dynamic>,
      );
      return response;
    } on NetworkException catch (e) {
      throw Exception('PUT /sub-ai-box/providers/$providerName/config failed: ${e.message}');
    } catch (e) {
      throw Exception('PUT /sub-ai-box/providers/$providerName/config failed: $e');
    }
  }

  Future<Map<String, dynamic>> setProviderEnabled(String providerName, bool enabled) async {
    try {
      final response = await _client.put<Map<String, dynamic>>(
        '/sub-ai-box/providers/$providerName/enabled',
        data: {'enabled': enabled},
        fromJson: (data) => data as Map<String, dynamic>,
      );
      return response;
    } on NetworkException catch (e) {
      throw Exception('PUT /sub-ai-box/providers/$providerName/enabled failed: ${e.message}');
    } catch (e) {
      throw Exception('PUT /sub-ai-box/providers/$providerName/enabled failed: $e');
    }
  }

  Future<Map<String, dynamic>> testProviderConnection(String providerName) async {
    try {
      final response = await _client.post<Map<String, dynamic>>(
        '/sub-ai-box/providers/$providerName/test',
        fromJson: (data) => data as Map<String, dynamic>,
      );
      return response;
    } on NetworkException catch (e) {
      throw Exception('POST /sub-ai-box/providers/$providerName/test failed: ${e.message}');
    } catch (e) {
      throw Exception('POST /sub-ai-box/providers/$providerName/test failed: $e');
    }
  }

  // Agent management
  Future<Map<String, dynamic>> listAgents() async {
    return getJson('/sub-ai-box/agents');
  }

  Future<Map<String, dynamic>> createAgent(Map<String, dynamic> agentData) async {
    try {
      final response = await _client.post<Map<String, dynamic>>(
        '/sub-ai-box/agents',
        data: agentData,
        fromJson: (data) => data as Map<String, dynamic>,
      );
      return response;
    } on NetworkException catch (e) {
      throw Exception('POST /sub-ai-box/agents failed: ${e.message}');
    } catch (e) {
      throw Exception('POST /sub-ai-box/agents failed: $e');
    }
  }

  Future<Map<String, dynamic>> getAgent(String agentId) async {
    return getJson('/sub-ai-box/agents/$agentId');
  }

  // Chat
  Future<Map<String, dynamic>> chat(Map<String, dynamic> chatRequest) async {
    try {
      final response = await _client.post<Map<String, dynamic>>(
        '/sub-ai-box/chat',
        data: chatRequest,
        fromJson: (data) => data as Map<String, dynamic>,
      );
      return response;
    } on NetworkException catch (e) {
      throw Exception('POST /sub-ai-box/chat failed: ${e.message}');
    } catch (e) {
      throw Exception('POST /sub-ai-box/chat failed: $e');
    }
  }

  // Health check
  Future<Map<String, dynamic>> aiBoxHealth() async {
    return getJson('/sub-ai-box/health');
  }
}