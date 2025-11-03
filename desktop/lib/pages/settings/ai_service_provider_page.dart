import 'package:desktop/models/ai_provider_model.dart';
import 'package:desktop/providers/ai_provider_state_interface.dart';
import 'package:desktop/widgets/error_message_bar.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

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
    
    ///// 默认情况下，认为错误是可重试的
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

  Widget _buildProviderGroup(BuildContext context, String title, List<AiProvider> providers) {
    final providerState = Provider.of<AIProviderStateInterface>(context, listen: false);

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
              selected: providerState.selectedProvider == provider,
              selectedTileColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              onTap: () => providerState.selectProvider(provider.id),
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

    return Expanded(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Icon(_getProviderIcon(selectedProvider.name), size: 28, color: Theme.of(context).primaryColor),
                const SizedBox(width: 12),
                Text(selectedProvider.name, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                const Spacer(),
                Switch(
                  value: selectedProvider.enabled, 
                  onChanged: (value) async {
                    await providerState.toggleProvider(selectedProvider.id, value);
                  }
                ),
              ],
            ),
            const SizedBox(height: 24),
            const Divider(),
            const SizedBox(height: 24),

            // Configuration Form
            _ProviderConfigForm(
              provider: selectedProvider,
              onConfigChanged: (config) async {
                await providerState.updateProviderConfig(selectedProvider.id, config);
              },
              onTestConnection: () async {
                final result = await providerState.testProviderConnection(selectedProvider.id);
              return result.ok;
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _ProviderConfigForm extends StatefulWidget {
  final AiProvider provider;
  final Function(ProviderConfig) onConfigChanged;
  final Future<bool> Function() onTestConnection;

  const _ProviderConfigForm({
    required this.provider,
    required this.onConfigChanged,
    required this.onTestConnection,
  });

  @override
  State<_ProviderConfigForm> createState() => _ProviderConfigFormState();
}

class _ProviderConfigFormState extends State<_ProviderConfigForm> {
  late Map<String, TextEditingController> _controllers;
  bool _isTestingConnection = false;
  String? _testResult;

  @override
  void initState() {
    super.initState();
    _controllers = {};
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
        // Provider Information
        const Text(
          'Provider Information',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 16),
        
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(_getProviderIcon(widget.provider.name), size: 24),
                    const SizedBox(width: 8),
                    Text(
                      widget.provider.name,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text('ID: ${widget.provider.id}'),
                Text('Status: ${widget.provider.enabled ? "Enabled" : "Disabled"}'),
              ],
            ),
          ),
        ),
        
        const SizedBox(height: 24),
        
        // Configuration Section
        const Text(
          'Configuration',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 16),
        
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Basic configuration fields based on provider type
                if (widget.provider.name.toLowerCase().contains('openai')) ...[
                  _buildTextField('API Key', 'api_key', obscureText: true),
                  const SizedBox(height: 16),
                  _buildTextField('Base URL', 'base_url', hintText: 'https://api.openai.com/v1'),
                ] else if (widget.provider.name.toLowerCase().contains('ollama')) ...[
                  _buildTextField('Host', 'host', hintText: 'http://localhost:11434'),
                ] else if (widget.provider.name.toLowerCase().contains('anthropic')) ...[
                  _buildTextField('API Key', 'api_key', obscureText: true),
                  const SizedBox(height: 16),
                  _buildTextField('Base URL', 'base_url', hintText: 'https://api.anthropic.com'),
                ] else ...[
                  _buildTextField('API Key', 'api_key', obscureText: true),
                  const SizedBox(height: 16),
                  _buildTextField('Base URL', 'base_url'),
                ],
              ],
            ),
          ),
        ),
        
        const SizedBox(height: 24),
        
        // Connectivity Check
        const Text(
          'Connectivity Check',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        const Text(
          'Test if the configuration is correct and the provider is accessible',
          style: TextStyle(fontSize: 12, color: Colors.grey),
        ),
        const SizedBox(height: 16),
        
        Row(
          children: [
            ElevatedButton.icon(
              onPressed: _isTestingConnection ? null : _testConnection,
              icon: _isTestingConnection 
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.wifi_tethering),
              label: Text(_isTestingConnection ? 'Testing...' : 'Test Connection'),
            ),
            const SizedBox(width: 16),
            if (_testResult != null) ...[
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: _testResult!.contains('success') || _testResult!.contains('Success')
                        ? Colors.green.shade50
                        : Colors.red.shade50,
                    border: Border.all(
                      color: _testResult!.contains('success') || _testResult!.contains('Success')
                          ? Colors.green
                          : Colors.red,
                    ),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    _testResult!,
                    style: TextStyle(
                      color: _testResult!.contains('success') || _testResult!.contains('Success')
                          ? Colors.green.shade700
                          : Colors.red.shade700,
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

  Widget _buildTextField(String label, String key, {String? hintText, bool obscureText = false}) {
    if (!_controllers.containsKey(key)) {
      _controllers[key] = TextEditingController();
    }
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.w500)),
        const SizedBox(height: 8),
        TextField(
          controller: _controllers[key],
          obscureText: obscureText,
          decoration: InputDecoration(
            hintText: hintText,
            border: const OutlineInputBorder(),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          ),
          onChanged: (value) {
            _onConfigChanged();
          },
        ),
      ],
    );
  }

  void _onConfigChanged() {
    final config = <String, dynamic>{};
    for (final entry in _controllers.entries) {
      if (entry.value.text.isNotEmpty) {
        config[entry.key] = entry.value.text;
      }
    }
    
    // Create ProviderConfig object
    final providerConfig = ProviderConfig.fromJson(config);
    widget.onConfigChanged(providerConfig);
  }

  Future<void> _testConnection() async {
    setState(() {
      _isTestingConnection = true;
      _testResult = null;
    });

    try {
      final success = await widget.onTestConnection();
      setState(() {
        _testResult = success ? 'Connection successful!' : 'Connection failed';
      });
    } catch (e) {
      setState(() {
        _testResult = 'Connection failed: $e';
      });
    } finally {
      setState(() {
        _isTestingConnection = false;
      });
    }
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
}