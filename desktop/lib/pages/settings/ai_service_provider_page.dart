import 'dart:convert';
import 'package:desktop/models/ai_provider.dart';
import 'package:desktop/providers/ai_provider_state_interface.dart';
import 'package:desktop/widgets/error_message_bar.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

import '../../providers/ai_provider_state.dart';
import '../../models/ai_provider.dart';
import '../../widgets/dynamic_config_fields.dart';

class AiServiceProviderPage extends StatelessWidget {
  const AiServiceProviderPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Models'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(
            color: Colors.grey.shade300,
            height: 1.0,
          ),
        ),
      ),
      body: Consumer<AIProviderStateInterface>(
        builder: (context, providerState, child) {
          return Column(
            children: [
              Expanded(
                child: providerState.isLoading && providerState.providers.isEmpty
                    ? const Center(child: CircularProgressIndicator())
                    : Row(
                        children: [
                          _buildLeftPanel(context),
                          const VerticalDivider(width: 1),
                          _buildRightPanel(context),
                        ],
                      ),
              ),
              // 错误消息bar显示在页面底部
              if (providerState.error != null)
                ErrorMessageBar(
                  message: providerState.error!,
                  isRetryable: _isErrorRetryable(providerState.error!),
                  onRetry: () {
                    providerState.clearError();
                    providerState.refreshProviders();
                  },
                  onClose: () {
                    providerState.clearError();
                  },
                ),
            ],
          );
        },
      ),
    );
  }

  /// 判断错误是否可重试
  /// 网络错误、超时错误、服务器错误等可重试
  /// 配置错误、认证错误、格式错误等不可重试
  static bool _isErrorRetryable(String error) {
    final errorLower = error.toLowerCase();
    
    // 不可重试的错误类型
    final nonRetryableErrors = [
      'invalid', 'unsupported', 'unauthorized', 'forbidden',
      'not found', 'bad request', 'malformed', 'format',
      'authentication', 'permission', 'access denied',
      'invalid api key', 'invalid token', 'invalid configuration'
    ];
    
    // 可重试的错误类型
    final retryableErrors = [
      'timeout', 'connection', 'network', 'server error',
      'service unavailable', 'internal server error',
      'failed to connect', 'connection refused', 'host unreachable'
    ];
    
    // 检查是否为明确不可重试的错误
    for (String nonRetryable in nonRetryableErrors) {
      if (errorLower.contains(nonRetryable)) {
        return false;
      }
    }
    
    // 检查是否为明确可重试的错误
    for (String retryable in retryableErrors) {
      if (errorLower.contains(retryable)) {
        return true;
      }
    }
    
    // 默认情况下，认为错误是可重试的
    return true;
  }

  Widget _buildLeftPanel(BuildContext context) {
    final providerState = Provider.of<AIProviderStateInterface>(context);

    return Container(
      width: 280,
      color: const Color(0xFFF9F9F9),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    decoration: InputDecoration(
                      hintText: 'Search Providers...',
                      prefixIcon: const Icon(Icons.search, size: 20),
                      filled: true,
                      fillColor: Colors.white,
                      contentPadding: EdgeInsets.zero,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8.0),
                        borderSide: BorderSide.none,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.refresh),
                  onPressed: () => providerState.refreshProviders(),
                  tooltip: 'Refresh providers',
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              children: [
                _buildProviderGroup(context, 'Enabled', providerState.enabledProviders),
                _buildProviderGroup(context, 'Disabled', providerState.disabledProviders),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProviderGroup(BuildContext context, String title, List<AIProvider> providers) {
    final providerState = Provider.of<AIProviderStateInterface>(context, listen: false);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: TextStyle(color: Colors.grey.shade600, fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
          ...providers.map((provider) {
            final providerInfo = providerState.getProviderInfo(provider.id);
            final isConnected = providerInfo?.status == 'connected';
            final hasError = providerInfo?.status == 'error';
            
            return ListTile(
              leading: Icon(provider.icon, color: Theme.of(context).primaryColor),
              title: Text(provider.name, style: const TextStyle(fontWeight: FontWeight.w500)),
              trailing: Icon(
                Icons.circle, 
                color: hasError ? Colors.red : (isConnected ? Colors.green : Colors.grey), 
                size: 10
              ),
              selected: providerState.selectedProvider == provider,
              selectedTileColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              onTap: () => providerState.selectProvider(provider),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildRightPanel(BuildContext context) {
    final providerState = Provider.of<AIProviderStateInterface>(context);
    final selectedProvider = providerState.selectedProvider;

    if (selectedProvider == null) {
      return const Expanded(child: Center(child: Text('Please select a provider.')));
    }

    final providerInfo = providerState.getProviderInfo(selectedProvider.id);

    return Expanded(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Icon(selectedProvider.icon, size: 28, color: Theme.of(context).primaryColor),
                const SizedBox(width: 12),
                Text(selectedProvider.name, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                const Spacer(),
                Switch(
                  value: selectedProvider.isEnabled, 
                  onChanged: (value) async {
                    await providerState.toggleProvider(selectedProvider);
                  }
                ),
              ],
            ),
            const SizedBox(height: 24),
            const Divider(),
            const SizedBox(height: 24),

            // Configuration Form
            if (providerInfo != null) ...[
              _ProviderConfigForm(
                providerInfo: providerInfo,
                onConfigChanged: (config) async {
                  await providerState.updateProviderConfig(selectedProvider.id, config);
                },
                onTestConnection: () async {
                  return await providerState.testProviderConnection(selectedProvider.id);
                },
              ),
            ] else ...[
              const Center(child: Text('Provider configuration not available')),
            ],
          ],
        ),
      ),
    );
  }
}

class _ProviderConfigForm extends StatefulWidget {
  final ProviderInfo providerInfo;
  final Function(Map<String, dynamic>) onConfigChanged;
  final Future<bool> Function() onTestConnection;

  const _ProviderConfigForm({
    required this.providerInfo,
    required this.onConfigChanged,
    required this.onTestConnection,
  });

  @override
  State<_ProviderConfigForm> createState() => _ProviderConfigFormState();
}

class _ProviderConfigFormState extends State<_ProviderConfigForm> {
  late Map<String, TextEditingController> _controllers;
  late Map<String, dynamic> _config;
  bool _isTestingConnection = false;
  String? _testResult;
  List<String> _selectedModels = [];
  bool _isRefreshingModels = false;
  bool _isConfigValid = true;

  @override
  void initState() {
    super.initState();
    _config = Map<String, dynamic>.from(widget.providerInfo.config);
    _controllers = {};
    
    // Initialize selected models from config or default to all available models
    _selectedModels = List<String>.from(_config['selected_models'] ?? 
        widget.providerInfo.models.map((m) => m.id).toList());
  }

  void _onValidationChanged(bool isValid) {
    setState(() {
      _isConfigValid = isValid;
    });
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Dynamic Configuration Fields
        if (widget.providerInfo.configFields.isNotEmpty) ...[
          const Text(
            'Configuration',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          DynamicConfigFields(
            configFields: widget.providerInfo.configFields,
            initialConfig: _config,
            onConfigChanged: (config) {
              setState(() {
                _config = config;
              });
              widget.onConfigChanged(config);
            },
            onValidationChanged: _onValidationChanged,
          ),
          const SizedBox(height: 24),
        ] else ...[
          // Fallback for providers without config fields defined
          const Text(
            'Configuration',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          _buildLegacyConfigFields(),
          const SizedBox(height: 24),
        ],

        // Model List Section
        const Text(
          'Model List',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        const Text(
          'Select the models to display in the session. The selected models will be displayed in the model list.',
          style: TextStyle(fontSize: 12, color: Colors.grey),
        ),
        const SizedBox(height: 16),
        
        // Model Selection
        _buildModelSelection(),
        
        const SizedBox(height: 24),
        
        // Connectivity Check
        const Text(
          'Connectivity Check',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        const Text(
          'Test if the API Key and proxy address are filled in correctly',
          style: TextStyle(fontSize: 12, color: Colors.grey),
        ),
        const SizedBox(height: 16),
        
        ElevatedButton(
          onPressed: _isTestingConnection ? null : _testConnection,
          child: _isTestingConnection
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Check'),
        ),
        
        const SizedBox(height: 24),
        
        // Save Configuration Button
        Row(
          children: [
            Expanded(
              child: ElevatedButton(
                onPressed: _isConfigValid ? _saveConfiguration : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: _isConfigValid ? Theme.of(context).primaryColor : Colors.grey,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: const Text('Save Configuration'),
              ),
            ),
          ],
        ),
        
        if (!_isConfigValid) ...[
          const SizedBox(height: 8),
          const Text(
            'Please fix validation errors before saving',
            style: TextStyle(color: Colors.red, fontSize: 12),
          ),
        ],
        
        if (_testResult != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _testResult!.contains('Success') 
                  ? Colors.green.withOpacity(0.1)
                  : Colors.red.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: _testResult!.contains('Success') 
                    ? Colors.green
                    : Colors.red,
              ),
            ),
            child: Text(
              _testResult!,
              style: TextStyle(
                color: _testResult!.contains('Success') 
                    ? Colors.green[700]
                    : Colors.red[700],
              ),
            ),
          ),
        ],
      ],
    );
  }

  // Legacy config fields for providers without defined config_fields
  Widget _buildLegacyConfigFields() {
    List<Widget> fields = [];
    
    // API Key field (always first)
    if (_config.containsKey('api_key')) {
      fields.add(_SettingsTextField(
        label: 'API Key',
        hint: 'Enter your API key',
        isPassword: true,
        controller: _controllers['api_key'] ??= TextEditingController(text: _config['api_key']?.toString() ?? ''),
        onChanged: (val) => _config['api_key'] = val,
      ));
    }

    // Interface proxy address field (prominent like lobe-chat)
    if (!_controllers.containsKey('interface_proxy_address')) {
      _controllers['interface_proxy_address'] = TextEditingController(
        text: _config['interface_proxy_address'] ?? _config['proxy_url'] ?? _config['endpoint'] ?? ''
      );
    }
    fields.add(_SettingsTextField(
      label: 'Interface proxy address',
      hint: 'http://192.168.31.213:11434',
      description: 'Must include http(s)://; can be left blank if not specified locally.',
      controller: _controllers['interface_proxy_address']!,
      onChanged: (val) => _config['interface_proxy_address'] = val,
      onFocusChange: (hasFocus) {
        // 当失去焦点时，自动获取模型列表
        if (!hasFocus && widget.providerInfo.name == 'ollama') {
          _autoFetchModelsOnAddressChange();
        }
      },
    ));

    // Use Client-Side Fetching Mode switch
    if (!_config.containsKey('use_client_side_fetching')) {
      _config['use_client_side_fetching'] = _config['use_client_request_mode'] ?? false;
    }
    fields.add(_SettingsSwitch(
      label: 'Use Client-Side Fetching Mode',
      description: 'Client-side fetching mode initiates session requests directly from the browser, improving response speed.',
      value: _config['use_client_side_fetching'] ?? false,
      onChanged: (val) => setState(() => _config['use_client_side_fetching'] = val),
    ));
    
    return Column(children: fields);
  }



  Widget _buildConnectionTestSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Connectivity Check', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Text(
          'Test if the API Key and proxy address are filled in correctly',
          style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
        ),
        const SizedBox(height: 16),
        
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            border: Border.all(color: Colors.grey.shade300),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Test Model:', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 8.0),
                          decoration: BoxDecoration(
                            color: Colors.grey.shade100,
                            borderRadius: BorderRadius.circular(6.0),
                          ),
                          child: Text(
                            _selectedModels.isNotEmpty 
                              ? _selectedModels.first
                              : (widget.providerInfo.models.isNotEmpty 
                                  ? widget.providerInfo.models.first.name
                                  : 'No models available'),
                            style: const TextStyle(fontSize: 13),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 16),
                  ElevatedButton(
                    onPressed: _isTestingConnection ? null : _testConnection,
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                    ),
                    child: _isTestingConnection 
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Check'),
                  ),
                ],
              ),
              
              if (_testResult != null) ...[
                const SizedBox(height: 16),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: _testResult!.startsWith('Success') ? Colors.green.shade50 : Colors.red.shade50,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: _testResult!.startsWith('Success') ? Colors.green.shade300 : Colors.red.shade300,
                      width: 1,
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        _testResult!.startsWith('Success') ? Icons.check_circle : Icons.error,
                        color: _testResult!.startsWith('Success') ? Colors.green.shade700 : Colors.red.shade700,
                        size: 20,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _testResult!,
                          style: TextStyle(
                            color: _testResult!.startsWith('Success') ? Colors.green.shade700 : Colors.red.shade700,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildModelListSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Text('Model List', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const Spacer(),
            ElevatedButton.icon(
              onPressed: _isRefreshingModels ? null : _refreshModelList,
              icon: _isRefreshingModels 
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh, size: 16),
              label: const Text('Get Model List'),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          'Select the models to display in the session. The selected models will be displayed in the model list.',
          style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
        ),
        const SizedBox(height: 16),
        
        // Model selection area
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            border: Border.all(color: Colors.grey.shade300),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Selected models display
              if (_selectedModels.isNotEmpty) ...[
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _selectedModels.map((model) => Chip(
                    label: Text(model),
                    deleteIcon: const Icon(Icons.close, size: 16),
                    onDeleted: () => _removeModel(model),
                    backgroundColor: Colors.blue.shade50,
                  )).toList(),
                ),
                const SizedBox(height: 12),
              ],
              
              // Model count info
              Row(
                children: [
                  Icon(Icons.info_outline, size: 16, color: Colors.grey.shade600),
                  const SizedBox(width: 4),
                  Text(
                    '${_selectedModels.length} models available in total',
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
                  ),
                ],
              ),
            ],
          ),
        ),
        
        const SizedBox(height: 16),
        
        // Available models list
        if (widget.providerInfo.models.isNotEmpty) ...[
          const Text('Available Models:', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
          ...widget.providerInfo.models.map((model) => Card(
            child: CheckboxListTile(
              title: Text(model.name),
              subtitle: Text(model.description),
              secondary: Chip(
                label: Text(model.type),
                backgroundColor: Colors.blue.shade50,
              ),
              value: _selectedModels.contains(model.id),
              onChanged: (bool? value) {
                if (value == true) {
                  _addModel(model.id);
                } else {
                  _removeModel(model.id);
                }
              },
            ),
          )),
        ] else ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.grey.shade50,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              children: [
                Icon(Icons.cloud_off, size: 48, color: Colors.grey.shade400),
                const SizedBox(height: 8),
                Text(
                  'No models available',
                  style: TextStyle(color: Colors.grey.shade600, fontSize: 14),
                ),
                const SizedBox(height: 4),
                Text(
                  'Click "Get Model List" to fetch available models',
                  style: TextStyle(color: Colors.grey.shade500, fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  String _formatLabel(String key) {
    return key.split('_').map((word) => 
      word[0].toUpperCase() + word.substring(1)
    ).join(' ');
  }

  String _getFieldDescription(String key) {
    switch (key) {
      case 'use_responses_api':
        return 'Use OpenAI\'s next-generation request format';
      case 'use_client_request_mode':
        return 'Client request mode will initiate session requests directly';
      default:
        return 'Configure ${_formatLabel(key).toLowerCase()}';
    }
  }

  Future<void> _testConnection() async {
    setState(() {
      _isTestingConnection = true;
      _testResult = null;
    });

    try {
      final success = await widget.onTestConnection();
      setState(() {
        _testResult = success ? 'Success: Connection established' : 'Failed: Unable to connect';
      });
    } catch (e) {
      setState(() {
        _testResult = 'Error: $e';
      });
    } finally {
      setState(() {
        _isTestingConnection = false;
      });
    }
  }

  void _saveConfiguration() async {
    // Update config with current controller values
    _controllers.forEach((key, controller) {
      _config[key] = controller.text;
    });
    
    // Prepare config for backend
    Map<String, dynamic> backendConfig = Map.from(_config);
    
    // Map frontend fields to backend fields
    if (backendConfig.containsKey('interface_proxy_address')) {
      String proxyAddress = backendConfig['interface_proxy_address'] ?? '';
      if (proxyAddress.isNotEmpty) {
        // For Ollama, use 'endpoint' field
        if (widget.providerInfo.name.toLowerCase() == 'ollama') {
          backendConfig['endpoint'] = proxyAddress;
        } else {
          // For other providers, use 'api_proxy_url'
          backendConfig['api_proxy_url'] = proxyAddress;
        }
      }
      // Remove frontend-specific field
      backendConfig.remove('interface_proxy_address');
    }
    
    // Map client-side fetching mode
    if (backendConfig.containsKey('use_client_side_fetching')) {
      backendConfig['client_request_mode'] = backendConfig['use_client_side_fetching'] ?? false;
      backendConfig.remove('use_client_side_fetching');
    }
    
    // Store selected models (this might need backend support)
    if (_selectedModels.isNotEmpty) {
      backendConfig['selected_models'] = _selectedModels;
    }
    
    try {
      await widget.onConfigChanged(backendConfig);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Configuration saved successfully')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to save configuration: $e')),
        );
      }
    }
  }

  void _addModel(String modelId) {
    setState(() {
      if (!_selectedModels.contains(modelId)) {
        _selectedModels.add(modelId);
      }
    });
  }

  void _removeModel(String modelId) {
    setState(() {
      _selectedModels.remove(modelId);
    });
  }

  Future<void> _refreshModelList() async {
    setState(() {
      _isRefreshingModels = true;
    });
    
    try {
      // For Ollama, we can try to fetch models from the API
      if (widget.providerInfo.name.toLowerCase() == 'ollama') {
        await _fetchOllamaModels();
      } else {
        // For other providers, show a message that models are predefined
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Model list is predefined for this provider'),
              duration: Duration(seconds: 2),
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to refresh model list: $e'),
            backgroundColor: Colors.red.shade600,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isRefreshingModels = false;
        });
      }
    }
  }
  
  Future<void> _autoFetchModelsOnAddressChange() async {
    // 检查地址是否有效
    String endpoint = _config['interface_proxy_address'] ?? '';
    if (endpoint.isEmpty || !endpoint.startsWith('http')) {
      return; // 地址无效，不执行自动获取
    }
    
    // 静默获取模型列表，不显示加载状态
    try {
      await _fetchOllamaModels();
      if (mounted) {
        setState(() {}); // 刷新UI以显示新获取的模型
      }
    } catch (e) {
      // 静默处理错误，不显示错误消息
      print('Auto fetch models failed: $e');
    }
  }
  
  Future<void> _fetchOllamaModels() async {
    // Get the endpoint from config
    String endpoint = _config['interface_proxy_address'] ?? 
                     _config['endpoint'] ?? 
                     'http://localhost:11434';
    
    if (endpoint.isEmpty) {
      throw Exception('Ollama endpoint not configured');
    }
    
    // Make HTTP request to Ollama API
    final client = http.Client();
    try {
      final response = await client.get(
        Uri.parse('$endpoint/api/tags'),
        headers: {'Content-Type': 'application/json'},
      ).timeout(const Duration(seconds: 10));
      
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['models'] != null) {
          List<dynamic> models = data['models'];
          List<ModelInfo> newModels = models.map((model) {
            String modelName = model['name'] ?? '';
            return ModelInfo(
              id: modelName,
              name: modelName,
              provider: 'ollama',
              type: 'chat',
              description: 'Ollama local model',
              maxTokens: 4096, // Default value
              capabilities: ['text'],
              pricing: {},
              isActive: true,
            );
          }).toList();
          
          // Update provider info with new models
          widget.providerInfo.models.clear();
          widget.providerInfo.models.addAll(newModels);
          
          // Reset selected models to include all new models
          _selectedModels = newModels.map((m) => m.name).toList();
          
          if (mounted) {
            setState(() {});
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Found ${newModels.length} models'),
                backgroundColor: Colors.green.shade600,
              ),
            );
          }
        }
      } else {
        throw Exception('HTTP ${response.statusCode}: ${response.body}');
      }
    } finally {
      client.close();
    }
  }

  Widget _buildModelSelection() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey.shade300),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Selected models display
          if (_selectedModels.isNotEmpty) ...[
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _selectedModels.map((model) => Chip(
                label: Text(model),
                deleteIcon: const Icon(Icons.close, size: 16),
                onDeleted: () => _removeModel(model),
                backgroundColor: Colors.blue.shade50,
              )).toList(),
            ),
            const SizedBox(height: 12),
          ],
          
          // Model count info
          Row(
            children: [
              Icon(Icons.info_outline, size: 16, color: Colors.grey.shade600),
              const SizedBox(width: 4),
              Text(
                '${_selectedModels.length} models selected',
                style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
              ),
            ],
          ),
          
          const SizedBox(height: 16),
          
          // Available models list
          if (widget.providerInfo.models.isNotEmpty) ...[
            const Text('Available Models:', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
            const SizedBox(height: 8),
            ...widget.providerInfo.models.map((model) => Card(
              child: CheckboxListTile(
                title: Text(model.name),
                subtitle: Text(model.description),
                secondary: Chip(
                  label: Text(model.type),
                  backgroundColor: Colors.blue.shade50,
                ),
                value: _selectedModels.contains(model.id),
                onChanged: (bool? value) {
                  if (value == true) {
                    _addModel(model.id);
                  } else {
                    _removeModel(model.id);
                  }
                },
              ),
            )),
          ] else ...[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.grey.shade50,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                children: [
                  Icon(Icons.cloud_off, size: 48, color: Colors.grey.shade400),
                  const SizedBox(height: 8),
                  Text(
                    'No models available',
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 14),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Click "Get Model List" to fetch available models',
                    style: TextStyle(color: Colors.grey.shade500, fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// Updated form field widgets

class _SettingsTextField extends StatelessWidget {
  final String label;
  final String hint;
  final String? description;
  final bool isPassword;
  final TextEditingController controller;
  final Function(String) onChanged;
  final Function(bool)? onFocusChange;

  const _SettingsTextField({
    required this.label,
    this.hint = '',
    this.description,
    this.isPassword = false,
    required this.controller,
    required this.onChanged,
    this.onFocusChange,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          if (description != null) ...[
            Text(
              description!,
              style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
            ),
            const SizedBox(height: 8),
          ],
          Focus(
            onFocusChange: onFocusChange,
            child: TextField(
              controller: controller,
              obscureText: isPassword,
              onChanged: onChanged,
              decoration: InputDecoration(
                hintText: hint,
                border: const OutlineInputBorder(),
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsSwitch extends StatelessWidget {
  final String label;
  final String description;
  final bool value;
  final Function(bool) onChanged;

  const _SettingsSwitch({
    required this.label,
    required this.description,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
                const SizedBox(height: 4),
                Text(description, style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
              ],
            ),
          ),
          Switch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }
}