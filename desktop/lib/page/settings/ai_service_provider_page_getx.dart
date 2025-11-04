import 'package:desktop/model/ai_provider_model.dart';
import 'package:desktop/controller/ai_provider_controller.dart';
import 'package:desktop/service/logging_service.dart';
import 'package:desktop/widget/error_message_bar.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class AiServiceProviderPageGetX extends StatelessWidget {
  const AiServiceProviderPageGetX({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<AIProviderController>();
    
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
      body: Obx(() {
        return Column(
          children: [
            Expanded(
              child: controller.isLoading.value && controller.providers.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : Row(
                      children: [
                        _buildLeftPanel(context, controller),
                        const VerticalDivider(width: 1),
                        _buildRightPanel(context, controller),
                      ],
                    ),
            ),
            // 错误消息bar显示在页面底部
            if (controller.error.value != null)
              ErrorMessageBar(
                message: controller.error.value!,
                isRetryable: _isErrorRetryable(controller.error.value!),
                onRetry: () {
                  controller.clearError();
                  controller.refreshProviders();
                },
                onClose: () {
                  controller.clearError();
                },
              ),
          ],
        );
      }),
    );
  }

  /// Determines if an error is retryable.
  /// Network errors, timeouts, and server errors are retryable.
  /// Configuration errors, authentication errors, and format errors are not.
  static bool _isErrorRetryable(String error) {
    final errorLower = error.toLowerCase();
    
    // Non-retryable error types
    final nonRetryableErrors = [
      'invalid', 'unsupported', 'unauthorized', 'forbidden',
      'not found', 'bad request', 'malformed', 'format',
      'authentication', 'permission', 'access denied',
      'invalid api key', 'invalid token', 'invalid configuration'
    ];
    
    // Retryable error types
    final retryableErrors = [
      'timeout', 'connection', 'network', 'server error',
      'service unavailable', 'internal server error',
      'failed to connect', 'connection refused', 'host unreachable'
    ];
    
    // Check for explicitly non-retryable errors
    for (String nonRetryable in nonRetryableErrors) {
      if (errorLower.contains(nonRetryable)) {
        return false;
      }
    }
    
    // Check for explicitly retryable errors
    for (String retryable in retryableErrors) {
      if (errorLower.contains(retryable)) {
        return true;
      }
    }
    
    // By default, assume the error is retryable
    return true;
  }

  IconData _getProviderIcon(String providerName) {
    switch (providerName.toLowerCase()) {
      case 'openai':
        return Icons.psychology;
      case 'anthropic':
        return Icons.smart_toy;
      case 'ollama':
        return Icons.computer;
      case 'google':
        return Icons.search;
      default:
        return Icons.cloud;
    }
  }

  Widget _buildLeftPanel(BuildContext context, AIProviderController controller) {
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
                  icon: controller.isRefreshing.value 
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.5)) 
                      : const Icon(Icons.refresh),
                  onPressed: controller.isRefreshing.value ? null : () => controller.refreshProviders(),
                  tooltip: 'Refresh providers',
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              children: [
                _buildProviderGroup(context, controller, 'Enabled', controller.enabledProviders),
                _buildProviderGroup(context, controller, 'Disabled', controller.disabledProviders),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProviderGroup(BuildContext context, AIProviderController controller, String title, List<AiProvider> providers) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: TextStyle(color: Colors.grey.shade600, fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
          ...providers.map((provider) {
            final isConnected = provider.enabled;
            
            return ListTile(
              leading: Icon(_getProviderIcon(provider.name), color: Theme.of(context).primaryColor),
              title: Text(provider.name, style: const TextStyle(fontWeight: FontWeight.w500)),
              trailing: Icon(
                Icons.circle, 
                color: isConnected ? Colors.green : Colors.grey, 
                size: 10
              ),
              selected: controller.selectedProvider.value == provider,
              selectedTileColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              onTap: () => controller.selectProvider(provider.id),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildRightPanel(BuildContext context, AIProviderController controller) {
    final selectedProvider = controller.selectedProvider.value;

    if (selectedProvider == null) {
      return Expanded(
        child: Container(
          color: Colors.white,
          child: const Center(
            child: Text('Select a provider to configure'),
          ),
        ),
      );
    }

    return Expanded(
      child: Container(
        color: Colors.white,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildProviderHeader(context, controller, selectedProvider),
              const SizedBox(height: 24),
              _buildProviderConfig(context, controller, selectedProvider),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildProviderHeader(BuildContext context, AIProviderController controller, AiProvider provider) {
    return Row(
      children: [
        Icon(_getProviderIcon(provider.name), size: 32, color: Theme.of(context).primaryColor),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(provider.name, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              if (provider.description.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(provider.description, style: const TextStyle(color: Colors.grey)),
              ],
            ],
          ),
        ),
        const SizedBox(width: 16),
        Row(
          children: [
            Switch(
              value: provider.enabled,
              onChanged: (value) => controller.toggleProvider(provider.id, value),
            ),
            const SizedBox(width: 8),
            Text(provider.enabled ? 'Enabled' : 'Disabled'),
          ],
        ),
      ],
    );
  }

  Widget _buildProviderConfig(BuildContext context, AIProviderController controller, AiProvider provider) {
    return _ProviderConfigForm(
      provider: provider,
      onConfigChanged: (config) => controller.updateProviderConfig(provider.id, config),
      onTestConnection: () => controller.testProviderConnection(provider.id),
    );
  }
}

class _ProviderConfigForm extends StatefulWidget {
  final AiProvider provider;
  final Function(ProviderConfig) onConfigChanged;
  final Future<TestProviderResponse> Function() onTestConnection;

  const _ProviderConfigForm({
    required this.provider,
    required this.onConfigChanged,
    required this.onTestConnection,
  });

  @override
  State<_ProviderConfigForm> createState() => _ProviderConfigFormState();
}

class _ProviderConfigFormState extends State<_ProviderConfigForm> {
  late final TextEditingController _apiKeyController;
  late final TextEditingController _baseUrlController;
  late final TextEditingController _proxyUrlController;
  late final TextEditingController _timeoutController;
  late final TextEditingController _maxRetriesController;

  late String _initialApiKey;
  late String _initialBaseUrl;
  late String _initialProxyUrl;
  late int _initialTimeout;
  late int _initialMaxRetries;

  final Map<String, bool> _isSaving = {};
  bool _isTestingConnection = false;
  TestProviderResponse? _testResult;
  String? _baseUrlError;

  @override
  void initState() {
    super.initState();
    _apiKeyController = TextEditingController(text: widget.provider.config.apiKey);
    _baseUrlController = TextEditingController(text: widget.provider.config.endpoint);
    _proxyUrlController = TextEditingController(text: widget.provider.config.proxyUrl);
    _timeoutController = TextEditingController(text: widget.provider.config.timeout.toString());
    _maxRetriesController = TextEditingController(text: widget.provider.config.maxRetries.toString());

    _initialApiKey = widget.provider.config.apiKey;
    _initialBaseUrl = widget.provider.config.endpoint;
    _initialProxyUrl = widget.provider.config.proxyUrl;
    _initialTimeout = widget.provider.config.timeout;
    _initialMaxRetries = widget.provider.config.maxRetries;
  }

  @override
  void dispose() {
    _apiKeyController.dispose();
    _baseUrlController.dispose();
    _proxyUrlController.dispose();
    _timeoutController.dispose();
    _maxRetriesController.dispose();
    super.dispose();
  }

  bool _validateUrl(String url) {
    if (url.isEmpty) {
      setState(() {
        _baseUrlError = null;
      });
      return true;
    }
    final uri = Uri.tryParse(url);
    if (uri != null && (uri.isScheme('http') || uri.isScheme('https'))) {
      setState(() {
        _baseUrlError = null;
      });
      return true;
    }
    setState(() {
      _baseUrlError = '请输入有效的HTTP/HTTPS URL';
    });
    return false;
  }

  Future<void> _handleFieldSubmitted(String field) async {
    String currentValue;
    String initialValue;
    
    switch (field) {
      case 'api_key':
        currentValue = _apiKeyController.text;
        initialValue = _initialApiKey;
        break;
      case 'endpoint':
        currentValue = _baseUrlController.text;
        initialValue = _initialBaseUrl;
        if (!_validateUrl(currentValue)) return;
        break;
      case 'proxy_url':
        currentValue = _proxyUrlController.text;
        initialValue = _initialProxyUrl;
        break;
      case 'timeout':
        currentValue = _timeoutController.text;
        initialValue = _initialTimeout.toString();
        break;
      case 'max_retries':
        currentValue = _maxRetriesController.text;
        initialValue = _initialMaxRetries.toString();
        break;
      default:
        return;
    }

    if (currentValue == initialValue) {
      return; // 无变化，无需保存
    }

    setState(() {
      _isSaving[field] = true;
    });

    final newConfig = ProviderConfig(
      apiKey: _apiKeyController.text,
      endpoint: _baseUrlController.text,
      proxyUrl: _proxyUrlController.text,
      timeout: int.tryParse(_timeoutController.text) ?? 30,
      maxRetries: int.tryParse(_maxRetriesController.text) ?? 3,
    );

    try {
      await widget.onConfigChanged(newConfig);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${widget.provider.name} 配置已更新'),
            backgroundColor: Colors.green.shade600,
            duration: const Duration(seconds: 2),
          ),
        );
        // 更新初始值
        _initialApiKey = _apiKeyController.text;
        _initialBaseUrl = _baseUrlController.text;
        _initialProxyUrl = _proxyUrlController.text;
        _initialTimeout = newConfig.timeout;
        _initialMaxRetries = newConfig.maxRetries;
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('更新 ${widget.provider.name} 失败: $e'),
            backgroundColor: Colors.red.shade600,
            duration: const Duration(seconds: 4),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSaving[field] = false;
        });
      }
    }
  }

  Future<void> _handleTestConnection() async {
    if (!_validateUrl(_baseUrlController.text)) {
      return;
    }
    setState(() {
      _isTestingConnection = true;
      _testResult = null;
    });
    try {
      final result = await widget.onTestConnection();
      setState(() {
        _testResult = result;
      });
    } catch (e) {
      setState(() {
        _testResult = TestProviderResponse(ok: false, message: '错误: $e');
      });
    } finally {
      if (mounted) {
        setState(() {
          _isTestingConnection = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 24),
          const Text('配置', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Card(
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildTextField(
                  label: 'API密钥',
                  controller: _apiKeyController,
                  isSaving: _isSaving['api_key'] ?? false,
                  onSubmitted: () => _handleFieldSubmitted('api_key'),
                  obscureText: true,
                ),
                const SizedBox(height: 16),
                _buildTextField(
                  label: '基础URL',
                  controller: _baseUrlController,
                  isSaving: _isSaving['endpoint'] ?? false,
                  onSubmitted: () => _handleFieldSubmitted('endpoint'),
                  errorText: _baseUrlError,
                ),
                const SizedBox(height: 16),
                _buildTextField(
                  label: '代理URL',
                  controller: _proxyUrlController,
                  isSaving: _isSaving['proxy_url'] ?? false,
                  onSubmitted: () => _handleFieldSubmitted('proxy_url'),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: _buildTextField(
                        label: '超时时间（秒）',
                        controller: _timeoutController,
                        isSaving: _isSaving['timeout'] ?? false,
                        onSubmitted: () => _handleFieldSubmitted('timeout'),
                        keyboardType: TextInputType.number,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: _buildTextField(
                        label: '最大重试次数',
                        controller: _maxRetriesController,
                        isSaving: _isSaving['max_retries'] ?? false,
                        onSubmitted: () => _handleFieldSubmitted('max_retries'),
                        keyboardType: TextInputType.number,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        const Text('连接测试', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        const Text(
          '测试配置是否正确以及提供商是否可访问',
          style: TextStyle(fontSize: 12, color: Colors.grey),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            ElevatedButton.icon(
              onPressed: _isTestingConnection ? null : _handleTestConnection,
              icon: _isTestingConnection
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.wifi_tethering),
              label: Text(_isTestingConnection ? '测试中...' : '测试连接'),
            ),
            const SizedBox(width: 16),
            if (_testResult != null) ...[
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: _testResult!.ok ? Colors.green.shade100 : Colors.red.shade100,
                    border: Border.all(color: _testResult!.ok ? Colors.green : Colors.red),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    _testResult!.message,
                    style: TextStyle(
                      color: _testResult!.ok ? Colors.green.shade700 : Colors.red.shade700,
                      fontSize: 12,
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ],
    );
  }

  Widget _buildTextField({
    required String label,
    required TextEditingController controller,
    required bool isSaving,
    required VoidCallback onSubmitted,
    bool obscureText = false,
    String? errorText,
    TextInputType? keyboardType,
  }) {
    final focusNode = FocusNode();
    focusNode.addListener(() {
      if (!focusNode.hasFocus) {
        onSubmitted();
      }
    });

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.w500)),
        const SizedBox(height: 8),
        TextField(
          controller: controller,
          focusNode: focusNode,
          obscureText: obscureText,
          keyboardType: keyboardType,
          decoration: InputDecoration(
            border: const OutlineInputBorder(),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            errorText: errorText,
            suffixIcon: isSaving
                ? const Padding(
                    padding: EdgeInsets.all(12.0),
                    child: SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : null,
          ),
        ),
      ],
    );
  }
}