import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/provider.dart';

class ProviderSettingsPage extends StatelessWidget {
  const ProviderSettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<ProviderController>();
    final tokens = Theme.of(context).extension<LobeTokens>()!;

    return Scaffold(
      backgroundColor: tokens.bgLevel1,
      body: Padding(
        padding: EdgeInsets.all(UIKit.spaceXl(context)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 头部标题
            Row(
              children: [
                Icon(Icons.cloud_queue, size: 32, color: tokens.textPrimary),
                const SizedBox(width: 16),
                Text(
                  "AI Service Providers",
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    color: tokens.textPrimary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                ElevatedButton.icon(
                  onPressed: () => _showAddProviderDialog(context, controller),
                  icon: const Icon(Icons.add),
                  label: const Text('Add Provider'),
                  style: UIKit.primaryButtonStyle(context),
                ),
              ],
            ),
            const SizedBox(height: 32),

            // 提供商列表
            Expanded(
              child: Obx(() {
                if (controller.isLoading.value) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (controller.providers.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.cloud_off_outlined,
                          size: 64,
                          color: tokens.textSecondary,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'No AI providers configured',
                          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            color: tokens.textSecondary,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Add your first AI service provider to get started',
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: tokens.textTertiary,
                          ),
                        ),
                        const SizedBox(height: 24),
                        ElevatedButton.icon(
                          onPressed: () => _showAddProviderDialog(context, controller),
                          icon: const Icon(Icons.add),
                          label: const Text('Add Provider'),
                          style: UIKit.primaryButtonStyle(context),
                        ),
                      ],
                    ),
                  );
                }

                return ListView.builder(
                  itemCount: controller.providers.length,
                  itemBuilder: (context, index) {
                    final provider = controller.providers[index];
                    return _buildProviderCard(context, controller, provider, tokens);
                  },
                );
              }),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProviderCard(
    BuildContext context,
    ProviderController controller,
    Provider provider,
    LobeTokens tokens,
  ) {
    final isCurrent = controller.currentProvider.value?.id == provider.id;

    return Card(
      elevation: 0,
      color: tokens.bgLevel2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
        side: BorderSide(
          color: isCurrent ? tokens.brandAccent : tokens.divider,
          width: isCurrent ? 2 : 1,
        ),
      ),
      child: Padding(
        padding: EdgeInsets.all(UIKit.spaceLg(context)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 头部信息
            Row(
              children: [
                // 提供商图标
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: tokens.brandAccent.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                  ),
                  child: Icon(
                    _getProviderIcon(provider.sourceType),
                    color: tokens.brandAccent,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 16),

                // 提供商信息
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        provider.name,
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: tokens.textPrimary,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        provider.description ?? _getProviderDescription(provider.sourceType),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: tokens.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),

                // 状态指示器
                Row(
                  children: [
                    if (isCurrent)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: tokens.brandAccent.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                        ),
                        child: Text(
                          'Current',
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: tokens.brandAccent,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    const SizedBox(width: 8),
                    Switch(
                      value: provider.enabled,
                      onChanged: (value) {
                        final updatedProvider = provider.copyWith(enabled: value);
                        controller.updateProvider(updatedProvider);
                      },
                    ),
                  ],
                ),
              ],
            ),

            const SizedBox(height: 16),

            // 配置信息
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _buildConfigRow(
                        context,
                        'Type',
                        provider.sourceType,
                        tokens,
                      ),
                      const SizedBox(height: 8),
                      _buildConfigRow(
                        context,
                        'Base URL',
                        provider.baseUrl ?? 'Not configured',
                        tokens,
                      ),
                      const SizedBox(height: 8),
                      _buildConfigRow(
                        context,
                        'Models',
                        '${provider.models.length} available',
                        tokens,
                      ),
                    ],
                  ),
                ),

                // 操作按钮
                Column(
                  children: [
                    ElevatedButton.icon(
                      onPressed: () => _showProviderDetails(context, controller, provider),
                      icon: const Icon(Icons.settings_outlined, size: 16),
                      label: const Text('Configure'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: tokens.bgLevel3,
                        foregroundColor: tokens.textPrimary,
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (!isCurrent)
                      OutlinedButton.icon(
                        onPressed: () => controller.setCurrentProvider(provider.id),
                        icon: const Icon(Icons.check_circle_outline, size: 16),
                        label: const Text('Use This'),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        ),
                      ),
                  ],
                ),
              ],
            ),

            const SizedBox(height: 16),

            // 底部操作栏
            Row(
              children: [
                TextButton.icon(
                  onPressed: () => controller.testProviderConnection(provider.id),
                  icon: const Icon(Icons.network_check, size: 16),
                  label: const Text('Test Connection'),
                  style: TextButton.styleFrom(
                    foregroundColor: tokens.textSecondary,
                  ),
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: () => _showDeleteConfirmation(context, controller, provider),
                  icon: const Icon(Icons.delete_outline, size: 16),
                  label: const Text('Delete'),
                  style: TextButton.styleFrom(
                    foregroundColor: Theme.of(context).colorScheme.error,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildConfigRow(
    BuildContext context,
    String label,
    String value,
    LobeTokens tokens,
  ) {
    return Row(
      children: [
        SizedBox(
          width: 80,
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: tokens.textSecondary,
            ),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Text(
            value,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: tokens.textPrimary,
            ),
          ),
        ),
      ],
    );
  }

  IconData _getProviderIcon(String sourceType) {
    switch (sourceType.toLowerCase()) {
      case 'openai':
        return Icons.smart_toy;
      case 'ollama':
        return Icons.computer;
      case 'anthropic':
        return Icons.psychology;
      case 'google':
        return Icons.search;
      default:
        return Icons.cloud;
    }
  }

  String _getProviderDescription(String sourceType) {
    switch (sourceType.toLowerCase()) {
      case 'openai':
        return 'OpenAI GPT models';
      case 'ollama':
        return 'Local AI models';
      case 'anthropic':
        return 'Claude AI models';
      case 'google':
        return 'Gemini AI models';
      default:
        return 'AI service provider';
    }
  }

  void _showAddProviderDialog(BuildContext context, ProviderController controller) {
    final sourceType = 'OpenAI'.obs;
    final nameController = TextEditingController();
    final apiKeyController = TextEditingController();
    final baseUrlController = TextEditingController();

    Get.defaultDialog(
      title: 'Add AI Provider',
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // 提供商类型选择
          Obx(() => DropdownButtonFormField<String>(
            value: sourceType.value,
            items: ['OpenAI', 'Ollama', 'Anthropic', 'Google', 'Custom']
                .map((type) => DropdownMenuItem(
                      value: type,
                      child: Text(type),
                    ))
                .toList(),
            onChanged: (value) {
              if (value != null) {
                sourceType.value = value;
                // 自动填充默认信息
                _autoFillProviderInfo(value, nameController, baseUrlController);
              }
            },
            decoration: const InputDecoration(
              labelText: 'Provider Type',
              border: OutlineInputBorder(),
            ),
          )),
          const SizedBox(height: 16),

          // 名称输入
          TextField(
            controller: nameController,
            decoration: const InputDecoration(
              labelText: 'Provider Name',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),

          // API密钥输入
          TextField(
            controller: apiKeyController,
            decoration: const InputDecoration(
              labelText: 'API Key',
              border: OutlineInputBorder(),
            ),
            obscureText: true,
          ),
          const SizedBox(height: 16),

          // 基础URL输入
          TextField(
            controller: baseUrlController,
            decoration: const InputDecoration(
              labelText: 'Base URL',
              border: OutlineInputBorder(),
            ),
          ),
        ],
      ),
      textConfirm: 'Add',
      textCancel: 'Cancel',
      onConfirm: () {
        if (nameController.text.isNotEmpty) {
          controller.addProvider(
            name: nameController.text,
            sourceType: sourceType.value,
            apiKey: apiKeyController.text,
            baseUrl: baseUrlController.text,
          );
        }
        Get.back();
      },
    );
  }

  void _autoFillProviderInfo(
    String sourceType,
    TextEditingController nameController,
    TextEditingController baseUrlController,
  ) {
    switch (sourceType) {
      case 'OpenAI':
        nameController.text = 'OpenAI';
        baseUrlController.text = 'https://api.openai.com/v1';
        break;
      case 'Ollama':
        nameController.text = 'Ollama';
        baseUrlController.text = 'http://localhost:11434';
        break;
      case 'Anthropic':
        nameController.text = 'Anthropic Claude';
        baseUrlController.text = 'https://api.anthropic.com';
        break;
      case 'Google':
        nameController.text = 'Google Gemini';
        baseUrlController.text = 'https://generativelanguage.googleapis.com';
        break;
    }
  }

  void _showProviderDetails(
    BuildContext context,
    ProviderController controller,
    Provider provider,
  ) {
    // 这里可以显示详细的提供商配置界面
    Get.to(() => ProviderDetailPage(provider: provider));
  }

  void _showDeleteConfirmation(
    BuildContext context,
    ProviderController controller,
    Provider provider,
  ) {
    Get.defaultDialog(
      title: 'Delete Provider',
      middleText: 'Are you sure you want to delete "${provider.name}"?',
      textConfirm: 'Delete',
      textCancel: 'Cancel',
      confirmTextColor: Colors.white,
      buttonColor: Colors.red,
      onConfirm: () {
        controller.deleteProvider(provider.id);
        Get.back();
      },
    );
  }
}

/// 提供商详情页面
class ProviderDetailPage extends StatelessWidget {
  final Provider provider;

  const ProviderDetailPage({super.key, required this.provider});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<ProviderController>();
    final tokens = Theme.of(context).extension<LobeTokens>()!;

    return Scaffold(
      backgroundColor: tokens.bgLevel1,
      appBar: AppBar(
        backgroundColor: tokens.bgLevel2,
        title: Text(provider.name),
        actions: [
          IconButton(
            icon: const Icon(Icons.save),
            onPressed: () {
              // 保存配置
              controller.updateProvider(provider);
              Get.back();
            },
          ),
        ],
      ),
      body: Padding(
        padding: EdgeInsets.all(UIKit.spaceXl(context)),
        child: ListView(
          children: [
            // 基础配置
            _buildSection(
              context,
              'Basic Configuration',
              [
                _buildTextField(
                  context,
                  'Provider Name',
                  provider.name,
                  (value) {},
                  tokens,
                ),
                const SizedBox(height: 16),
                _buildTextField(
                  context,
                  'Base URL',
                  provider.baseUrl ?? '',
                  (value) {},
                  tokens,
                ),
                const SizedBox(height: 16),
                _buildTextField(
                  context,
                  'API Key',
                  '••••••••',
                  (value) {},
                  tokens,
                  obscureText: true,
                ),
              ],
              tokens,
            ),

            const SizedBox(height: 24),

            // 高级配置
            _buildSection(
              context,
              'Advanced Configuration',
              [
                _buildSlider(
                  context,
                  'Temperature',
                  provider.config?['temperature'] ?? 0.7,
                  0.0,
                  2.0,
                  (value) {},
                  tokens,
                ),
                const SizedBox(height: 16),
                _buildSlider(
                  context,
                  'Max Tokens',
                  (provider.config?['maxTokens'] ?? 2048).toDouble(),
                  100,
                  8192,
                  (value) {},
                  tokens,
                ),
              ],
              tokens,
            ),

            const SizedBox(height: 24),

            // 模型管理
            _buildSection(
              context,
              'Model Management',
              [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Available Models',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: tokens.textPrimary,
                        ),
                      ),
                    ),
                    ElevatedButton.icon(
                      onPressed: () async {
                        final models = await controller.fetchProviderModels(provider.id);
                        // 更新模型列表
                        if (models.isNotEmpty) {
                          Get.snackbar('Success', 'Fetched ${models.length} models');
                        }
                      },
                      icon: const Icon(Icons.refresh),
                      label: const Text('Fetch Models'),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                ...provider.models.map((model) => _buildModelItem(
                  context,
                  model,
                  tokens,
                )),
              ],
              tokens,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSection(
    BuildContext context,
    String title,
    List<Widget> children,
    LobeTokens tokens,
  ) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: tokens.bgLevel2,
        borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
        border: Border.all(color: tokens.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
              color: tokens.textPrimary,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          ...children,
        ],
      ),
    );
  }

  Widget _buildTextField(
    BuildContext context,
    String label,
    String value,
    Function(String) onChanged,
    LobeTokens tokens, {
    bool obscureText = false,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: tokens.textSecondary,
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: TextEditingController(text: value),
          onChanged: onChanged,
          obscureText: obscureText,
          decoration: UIKit.inputDecoration(context).copyWith(
            hintText: 'Enter $label',
          ),
        ),
      ],
    );
  }

  Widget _buildSlider(
    BuildContext context,
    String label,
    double value,
    double min,
    double max,
    Function(double) onChanged,
    LobeTokens tokens,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              label,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: tokens.textSecondary,
              ),
            ),
            const Spacer(),
            Text(
              value.toStringAsFixed(2),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: tokens.textPrimary,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Slider(
          value: value,
          min: min,
          max: max,
          divisions: ((max - min) / 0.1).round(),
          onChanged: onChanged,
        ),
      ],
    );
  }

  Widget _buildModelItem(
    BuildContext context,
    String model,
    LobeTokens tokens,
  ) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tokens.bgLevel3,
        borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
        border: Border.all(color: tokens.divider),
      ),
      child: Row(
        children: [
          Icon(
            Icons.smart_toy_outlined,
            color: tokens.brandAccent,
            size: 20,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              model,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: tokens.textPrimary,
              ),
            ),
          ),
          IconButton(
            icon: Icon(
              Icons.delete_outline,
              color: Theme.of(context).colorScheme.error,
              size: 20,
            ),
            onPressed: () {
              // 删除模型逻辑
            },
          ),
        ],
      ),
    );
  }
}