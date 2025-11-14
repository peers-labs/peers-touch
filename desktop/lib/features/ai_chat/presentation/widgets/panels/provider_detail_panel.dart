import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:math';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/provider.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service_factory.dart';
import 'package:peers_touch_desktop/features/ai_chat/presentation/widgets/dialogs/add_model_dialog.dart';

class ProviderDetailPanel extends StatefulWidget {
  final Provider provider;

  const ProviderDetailPanel({super.key, required this.provider});

  @override
  State<ProviderDetailPanel> createState() => _ProviderDetailPanelState();
}

class _ProviderDetailPanelState extends State<ProviderDetailPanel> {
  late final TextEditingController _nameController;
  late final TextEditingController _baseUrlController;
  late final TextEditingController _apiKeyController;
  bool _isPasswordVisible = false;
  String? _selectedModel;
  bool _isCheckingConnection = false;
  String? _connectionStatus;
  bool _isConnectionSuccess = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.provider.name);
    _baseUrlController = TextEditingController(text: widget.provider.baseUrl);
    _apiKeyController = TextEditingController(text: widget.provider.keyVaults);
    // 初始化默认模型
    _selectedModel = widget.provider.models.firstOrNull;
  }

  @override
  void didUpdateWidget(covariant ProviderDetailPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.provider != oldWidget.provider) {
      _nameController.text = widget.provider.name;
      _baseUrlController.text = widget.provider.baseUrl ?? '';
      _apiKeyController.text = widget.provider.keyVaults ?? '';
      // 更新模型选择
      _selectedModel = widget.provider.models.firstOrNull;
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _baseUrlController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<ProviderController>();
    final tokens = Theme.of(context).extension<LobeTokens>()!;

    return Scaffold(
      backgroundColor: tokens.bgLevel1,
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: ListView(
          children: [
            _buildSectionHeader(context, widget.provider, controller, tokens),
            const SizedBox(height: 16),
            _buildSection(
              context,
              '接口代理地址',
              '必须包含 http(s)://，如果不是本地部署，则不能为空',
              _buildTextField(
                context,
                'Base URL',
                _baseUrlController,
                (value) {
                  final updatedSettings = Map<String, dynamic>.from(widget.provider.settings ?? {});
                  updatedSettings['baseUrl'] = value;
                  final updatedProvider = widget.provider.copyWith(settings: updatedSettings);
                  controller.updateProvider(updatedProvider);
                },
                tokens,
              ),
              tokens,
            ),
            const SizedBox(height: 16),
            _buildSection(
              context,
              'API Key',
              '请填写你的API Key',
              _buildTextField(
                context,
                'API Key',
                _apiKeyController,
                (value) {
                  final updatedProvider = widget.provider.copyWith(keyVaults: value);
                  controller.updateProvider(updatedProvider);
                },
                tokens,
                obscureText: !_isPasswordVisible,
                suffixIcon: IconButton(
                  icon: Icon(
                    _isPasswordVisible ? Icons.visibility : Icons.visibility_off,
                    color: tokens.textSecondary,
                  ),
                  onPressed: () {
                    setState(() {
                      _isPasswordVisible = !_isPasswordVisible;
                    });
                  },
                ),
              ),
              tokens,
            ),
            const SizedBox(height: 16),
            _buildSection(
              context,
              '连接检测',
              '检测Provider配置是否正确',
              _buildConnectivityCheck(context, controller, tokens),
              tokens,
            ),
            const SizedBox(height: 16),
            _buildSection(
              context,
              '模型列表',
              '默认展示的模型列表',
              _buildModelList(context, controller, tokens),
              tokens,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(BuildContext context, Provider provider, ProviderController controller, LobeTokens tokens) {
    return Row(
      children: [
        Icon(_getProviderIcon(provider.sourceType), size: 32, color: tokens.textPrimary),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            provider.name,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              color: tokens.textPrimary,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        Switch(
          value: provider.enabled,
          onChanged: (value) {
            final updatedProvider = provider.copyWith(enabled: value);
            controller.updateProvider(updatedProvider);
          },
        ),
        const SizedBox(width: 8),
        TextButton(
          onPressed: () => _showDeleteConfirmation(context, controller, provider),
          style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
          child: const Text('删除'),
        ),
      ],
    );
  }

  void _showDeleteConfirmation(BuildContext context, ProviderController controller, Provider provider) {
    Get.defaultDialog(
      title: '删除服务商',
      middleText: '你确定要删除 "${provider.name}" 吗？此操作不可逆。',
      textConfirm: '删除',
      textCancel: '取消',
      confirmTextColor: Colors.white,
      buttonColor: Theme.of(context).colorScheme.error,
      onConfirm: () {
        controller.deleteProvider(provider.id);
        Get.back(); // close dialog
      },
    );
  }

  Widget _buildSection(BuildContext context, String title, String subtitle, Widget content, LobeTokens tokens) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(color: tokens.textPrimary, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(subtitle, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textSecondary)),
        const SizedBox(height: 12),
        content,
      ],
    );
  }

  Widget _buildTextField(BuildContext context, String label, TextEditingController controller, ValueChanged<String> onChanged, LobeTokens tokens, {bool obscureText = false, Widget? suffixIcon}) {
    return TextFormField(
      controller: controller,
      obscureText: obscureText,
      style: TextStyle(color: tokens.textPrimary),
      decoration: UIKit.inputDecoration(context).copyWith(
        hintText: '输入$label',
        suffixIcon: suffixIcon,
      ),
      onChanged: onChanged,
    );
  }

  Widget _buildConnectivityCheck(BuildContext context, ProviderController controller, LobeTokens tokens) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                value: _selectedModel ?? widget.provider.models.firstOrNull,
                decoration: UIKit.inputDecoration(context).copyWith(
                  hintText: '选择模型',
                  prefixIcon: const Icon(Icons.model_training, size: 18),
                ),
                items: widget.provider.models.map((model) {
                  return DropdownMenuItem(
                    value: model,
                    child: Text(model, style: TextStyle(color: tokens.textPrimary)),
                  );
                }).toList(),
                onChanged: (value) {
                  setState(() {
                    _selectedModel = value;
                  });
                },
                dropdownColor: tokens.bgLevel2,
                style: TextStyle(color: tokens.textPrimary),
              ),
            ),
            const SizedBox(width: 12),
            ElevatedButton.icon(
              onPressed: _isCheckingConnection ? null : _checkConnection,
              icon: _isCheckingConnection 
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.check_circle_outline, size: 18),
              label: Text(_isCheckingConnection ? '检测中...' : '检测'),
              style: ElevatedButton.styleFrom(
                backgroundColor: tokens.brandAccent,
                foregroundColor: Colors.white,
              ),
            ),
          ],
        ),
        if (_connectionStatus != null) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _isConnectionSuccess 
                ? Colors.green.withOpacity(0.1) 
                : Colors.red.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: _isConnectionSuccess ? Colors.green : Colors.red,
                width: 1,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  _isConnectionSuccess ? Icons.check_circle : Icons.error_outline,
                  color: _isConnectionSuccess ? Colors.green : Colors.red,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _connectionStatus!,
                    style: TextStyle(
                      color: _isConnectionSuccess ? Colors.green : Colors.red,
                      fontSize: 14,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Future<void> _checkConnection() async {
    if (_selectedModel == null) {
      setState(() {
        _connectionStatus = '请先选择一个模型';
        _isConnectionSuccess = false;
      });
      return;
    }

    setState(() {
      _isCheckingConnection = true;
      _connectionStatus = null;
    });

    try {
      // OpenAI协议连接检测
      final baseUrl = _baseUrlController.text.trim();
      final apiKey = _apiKeyController.text.trim();
      
      if (baseUrl.isEmpty || apiKey.isEmpty) {
        setState(() {
          _connectionStatus = 'Base URL和API Key不能为空';
          _isConnectionSuccess = false;
          _isCheckingConnection = false;
        });
        return;
      }

      // 构建Chat Completion API的请求URL用于连接检测
      Uri uri;
      String chatCompletionPath;
      
      // 使用标准聊天补全路径
      chatCompletionPath = '/chat/completions';
      
      // 允许通过配置完全自定义聊天补全端点URL
      if (widget.provider.config?.containsKey('chat_completion_endpoint') ?? false) {
        // 使用完全自定义的URL
        uri = Uri.parse(widget.provider.config!['chat_completion_endpoint'] as String);
      } else {
        // 使用基础URL拼接聊天补全路径
        uri = Uri.parse(baseUrl).resolve(chatCompletionPath);
      }
      
      // 打印详细调试信息
      print('=== ${widget.provider.sourceType} 连接检测URL构造详情 ===');
      print('基础URL: $baseUrl');
      print('聊天补全路径: $chatCompletionPath');
      print('构造的完整URL: ${uri.toString()}');
      print('URL组成部分:');
      print('  Scheme: ${uri.scheme}');
      print('  Host: ${uri.host}');
      print('  Port: ${uri.port}');
      print('  Path: ${uri.path}');
      print('====================================');
      
      // 发送聊天补全请求进行连接检测 (使用构造的正确URL)
      final requestBody = json.encode({
        'model': _selectedModel,
        'messages': [
          {'role': 'system', 'content': '你是人工智能助手'},
          {'role': 'user', 'content': '连接测试'}
        ]
      });
      
      // 记录请求详情
      LoggingService.debug('=== AI 请求详情 ===');
      LoggingService.debug('URL: ${uri.toString()}');
      LoggingService.debug('Headers:');
      LoggingService.debug('  Authorization: Bearer ${apiKey.substring(0, 10)}...'); // 只显示部分API Key
      LoggingService.debug('  Content-Type: application/json');
      LoggingService.debug('请求体: $requestBody');
      LoggingService.debug('=============================');
      
      final response = await http.post(
        uri,
        headers: {
          'Authorization': 'Bearer $apiKey',
          'Content-Type': 'application/json',
        },
        body: requestBody,
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        // 解析聊天补全响应数据
        final data = json.decode(response.body);
        
        // 检查响应是否包含choices
        if (data.containsKey('choices') && data['choices'] is List && data['choices'].isNotEmpty) {
          setState(() {
            _connectionStatus = '连接成功！Provider配置正确，模型 $_selectedModel 可用。';
            _isConnectionSuccess = true;
            _isCheckingConnection = false;
          });
        } else {
          setState(() {
            _connectionStatus = '连接成功，但响应格式不符合预期。';
            _isConnectionSuccess = false;
            _isCheckingConnection = false;
          });
        }
      } else if (response.statusCode == 401) {
        setState(() {
          _connectionStatus = '连接失败：API Key无效或缺失。';
          _isConnectionSuccess = false;
          _isCheckingConnection = false;
        });
      } else {
        setState(() {
          // 显示完整错误信息以便诊断
          _connectionStatus = '连接失败：HTTP ${response.statusCode} - ${response.reasonPhrase}\nURL: ${uri.toString()}\n响应内容: ${response.body.substring(0, min(200, response.body.length))}';
          _isConnectionSuccess = false;
          _isCheckingConnection = false;
        });
      }
      
    } catch (e) {
      setState(() {
        _connectionStatus = '连接失败：${e.toString()}';
        _isConnectionSuccess = false;
        _isCheckingConnection = false;
      });
    }
  }

  Widget _buildModelList(BuildContext context, ProviderController controller, LobeTokens tokens) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                decoration: UIKit.inputDecoration(context).copyWith(
                  hintText: '搜索模型...',
                  prefixIcon: const Icon(Icons.search, size: 18),
                ),
              ),
            ),
            const SizedBox(width: 8),
            TextButton.icon(
              onPressed: () => _showAddModelDialog(context),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Add Model'),
            ),
            const SizedBox(width: 8),
            TextButton.icon(
              onPressed: () => controller.fetchProviderModels(widget.provider.id),
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Fetch models'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Column(
              children: widget.provider.models.map((model) {
                    // 获取模型元数据
                    final modelsMetadata = widget.provider.settings?['modelsMetadata'] as Map<String, dynamic>?;
                    final modelMeta = modelsMetadata?[model] as Map<String, dynamic>?;
                    final displayName = modelMeta?['name'] ?? model;
                    return CheckboxListTile(
                      title: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(displayName, style: TextStyle(
                            color: tokens.textPrimary,
                            fontSize: 16,
                            fontWeight: FontWeight.bold
                          )),
                          Text(model, style: TextStyle(
                            color: tokens.textSecondary,
                            fontSize: 12
                          )),
                        ],
                      ),
                      value: true, // TODO: Implement model selection
                      onChanged: (value) {},
                      dense: true,
                      controlAffinity: ListTileControlAffinity.leading,
                    );
                  }).toList(),
            ),
      ],
    );
  }

  void _showAddModelDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AddModelDialog(provider: widget.provider),
    );
  }

  IconData _getProviderIcon(String sourceType) {
    switch (sourceType.toLowerCase()) {
      case 'openai':
        return Icons.smart_toy_outlined;
      case 'ollama':
        return Icons.computer_outlined;
      case 'anthropic':
        return Icons.psychology_outlined;
      case 'google':
        return Icons.android_outlined;
      default:
        return Icons.cloud_outlined;
    }
  }
}