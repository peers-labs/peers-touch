class MockBackendClient {
  // Mock data for testing
  static const Map<String, dynamic> _mockProviders = {
    'ollama': {
      'name': 'ollama',
      'displayName': 'Ollama',
      'enabled': true,
      'config': {
        'endpoint': 'http://localhost:11434',
        'origins': '*'
      },
      'configFields': [
        {
          'name': 'endpoint',
          'type': 'string',
          'required': true,
          'description': 'Ollama server endpoint URL',
          'envVar': 'OLLAMA_ENDPOINT',
          'defaultValue': 'http://localhost:11434'
        },
        {
          'name': 'origins',
          'type': 'string',
          'required': false,
          'description': 'Allowed origins for CORS',
          'envVar': 'OLLAMA_ORIGINS',
          'defaultValue': '*'
        }
      ],
      'models': [
        {
          'id': 'llama2',
          'name': 'Llama 233',
          'provider': 'ollama',
          'type': 'chat',
          'description': 'Meta\'s Llama 2 model',
          'maxTokens': 4096,
          'capabilities': ['chat', 'completion'],
          'isActive': true
        }
      ],
      'status': 'connected',
      'error': null
    },
    'openai': {
      'name': 'openai',
      'displayName': 'OpenAI',
      'enabled': false,
      'config': {
        'api_key': '',
        'proxy_url': ''
      },
      'configFields': [
        {
          'name': 'api_key',
          'type': 'string',
          'required': true,
          'description': 'OpenAI API key for authentication',
          'envVar': 'OPENAI_API_KEY'
        },
        {
          'name': 'proxy_url',
          'type': 'string',
          'required': false,
          'description': 'Proxy URL for API requests (optional)',
          'envVar': 'OPENAI_PROXY_URL'
        }
      ],
      'models': [
        {
          'id': 'gpt-4',
          'name': 'GPT-4',
          'provider': 'openai',
          'type': 'chat',
          'description': 'Most capable GPT-4 model',
          'maxTokens': 8192,
          'capabilities': ['chat', 'completion'],
          'pricing': {
            'input': 0.03,
            'output': 0.06
          },
          'isActive': true
        }
      ],
      'status': 'disconnected',
      'error': null
    },
    'anthropic': {
      'name': 'anthropic',
      'displayName': 'Anthropic Claude',
      'enabled': false,
      'config': {
        'api_key': '',
        'max_tokens': 1000,
        'temperature': 0.7,
        'stream': true
      },
      'configFields': [
        {
          'name': 'api_key',
          'type': 'string',
          'required': true,
          'description': 'Anthropic API key for authentication',
          'envVar': 'ANTHROPIC_API_KEY'
        },
        {
          'name': 'max_tokens',
          'type': 'number',
          'required': false,
          'description': 'Maximum number of tokens to generate',
          'defaultValue': '1000'
        },
        {
          'name': 'temperature',
          'type': 'number',
          'required': false,
          'description': 'Sampling temperature (0.0 to 1.0)',
          'defaultValue': '0.7'
        },
        {
          'name': 'stream',
          'type': 'boolean',
          'required': false,
          'description': 'Enable streaming responses',
          'defaultValue': 'true'
        }
      ],
      'models': [
        {
          'id': 'claude-3-opus-20240229',
          'name': 'Claude 3 Opus',
          'provider': 'anthropic',
          'type': 'chat',
          'description': 'Most powerful Claude 3 model',
          'maxTokens': 200000,
          'capabilities': ['chat', 'completion', 'analysis'],
          'pricing': {
            'input': 0.015,
            'output': 0.075
          },
          'isActive': true
        }
      ],
      'status': 'disconnected',
      'error': null
    }
  };

  Future<Map<String, dynamic>> listProviderInfos() async {
    await Future.delayed(const Duration(milliseconds: 100)); // Simulate network delay
    
    return {
      'success': true,
      'providers': _mockProviders.values.toList()
    };
  }

  Future<Map<String, dynamic>> getProviderInfo(String providerName) async {
    await Future.delayed(const Duration(milliseconds: 100));
    
    final provider = _mockProviders[providerName];
    if (provider == null) {
      return {
        'success': false,
        'error': 'Provider $providerName not found'
      };
    }
    
    return {
      'success': true,
      'data': provider
    };
  }

  Future<Map<String, dynamic>> updateProviderConfig(String providerName, Map<String, dynamic> config) async {
    await Future.delayed(const Duration(milliseconds: 200));
    
    final provider = _mockProviders[providerName];
    if (provider == null) {
      return {
        'success': false,
        'error': 'Provider $providerName not found'
      };
    }
    
    // Simulate validation
    final configFields = provider['configFields'] as List<dynamic>;
    for (final field in configFields) {
      final fieldMap = field as Map<String, dynamic>;
      final fieldName = fieldMap['name'] as String;
      final required = fieldMap['required'] as bool;
      
      if (required && (config[fieldName] == null || config[fieldName] == '')) {
        return {
          'success': false,
          'error': 'Field $fieldName is required'
        };
      }
    }
    
    // Update the mock data
    final providerConfig = provider['config'] as Map<String, dynamic>;
    providerConfig.addAll(config);
    
    return {
      'success': true,
      'data': provider
    };
  }

  Future<Map<String, dynamic>> toggleProvider(String providerName) async {
    await Future.delayed(const Duration(milliseconds: 100));
    
    final provider = _mockProviders[providerName];
    if (provider == null) {
      return {
        'success': false,
        'error': 'Provider $providerName not found'
      };
    }
    
    provider['enabled'] = !(provider['enabled'] as bool);
    
    return {
      'success': true,
      'data': provider
    };
  }

  Future<Map<String, dynamic>> testProviderConnection(String providerName) async {
    await Future.delayed(const Duration(milliseconds: 500)); // Simulate connection test delay
    
    final provider = _mockProviders[providerName];
    if (provider == null) {
      return {
        'success': false,
        'error': 'Provider $providerName not found'
      };
    }
    
    // Simulate connection test logic
    if (providerName == 'ollama') {
      return {
        'success': true,
        'message': 'Connection successful'
      };
    } else {
      final config = provider['config'] as Map<String, dynamic>;
      final apiKey = config['api_key'] as String?;
      
      if (apiKey != null && apiKey.isNotEmpty) {
        return {
          'success': true,
          'message': 'Connection successful'
        };
      } else {
        return {
          'success': false,
          'error': 'API key is required for connection test'
        };
      }
    }
  }
}