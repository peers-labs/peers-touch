import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/provider.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service_factory.dart';

class ProviderDetailPanel extends StatefulWidget {
  final Provider provider;

  const ProviderDetailPanel({super.key, required this.provider});

  @override
  State<ProviderDetailPanel> createState() => _ProviderDetailPanelState();
}

class _ProviderDetailPanelState extends State<ProviderDetailPanel> {
  final List<String> _models = [];
  DateTime? _lastFetchAt;
  // 待保存的编辑值
  String? _pendingName;
  String? _pendingBaseUrl;
  String? _pendingApiKey;
  double? _pendingTemperature;
  double? _pendingMaxTokens;

  @override
  void initState() {
    super.initState();
    // 初始加载：从 Provider 的已保存设置中读取模型与更新时间
    final saved = widget.provider.models;
    if (saved.isNotEmpty) {
      _models
        ..clear()
        ..addAll(saved);
    }
    final updatedAtStr = widget.provider.settings?['modelsUpdatedAt']?.toString();
    if (updatedAtStr != null && updatedAtStr.isNotEmpty) {
      try {
        _lastFetchAt = DateTime.parse(updatedAtStr);
      } catch (_) {
        _lastFetchAt = null;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<ProviderController>();
    final tokens = Theme.of(context).extension<LobeTokens>()!;

    return Scaffold(
      backgroundColor: tokens.bgLevel2,
      appBar: AppBar(
        backgroundColor: tokens.bgLevel2,
        elevation: 0,
        title: Text(widget.provider.name, style: TextStyle(color: tokens.textPrimary)),
        actions: [
          Tooltip(
            message: '保存更改',
            child: IconButton(
              icon: const Icon(Icons.save),
              onPressed: () async {
                final controller = Get.find<ProviderController>();
                // 合并 settings 与 config
                final newSettings = Map<String, dynamic>.from(widget.provider.settings ?? {});
                if (_pendingBaseUrl != null && _pendingBaseUrl!.isNotEmpty) {
                  newSettings['baseUrl'] = _pendingBaseUrl;
                }
                final newConfig = Map<String, dynamic>.from(widget.provider.config ?? {});
                if (_pendingTemperature != null) {
                  newConfig['temperature'] = _pendingTemperature;
                }
                if (_pendingMaxTokens != null) {
                  newConfig['maxTokens'] = _pendingMaxTokens!.round();
                }
                var updated = widget.provider.copyWith(
                  name: _pendingName ?? widget.provider.name,
                  settings: newSettings,
                  config: newConfig,
                  updatedAt: DateTime.now().toUtc(),
                );
                await controller.updateProvider(updated);
                // API Key 单独写入安全存储
                if (_pendingApiKey != null && _pendingApiKey!.isNotEmpty) {
                  await controller.updateApiKey(widget.provider.id, _pendingApiKey!);
                }
              },
            ),
          ),
        ],
        automaticallyImplyLeading: false,
      ),
      body: Padding(
        padding: EdgeInsets.all(UIKit.spaceLg(context)),
        child: ListView(
          children: [
            _buildSection(
              context,
              'Basic Configuration',
              [
                _buildTextField(context, 'Provider Name', widget.provider.name, (value) {
                  _pendingName = value;
                }, tokens),
                const SizedBox(height: 16),
                _buildTextField(context, 'Base URL', widget.provider.baseUrl ?? '', (value) {
                  _pendingBaseUrl = value;
                }, tokens),
                const SizedBox(height: 16),
                _buildTextField(context, 'API Key', '••••••••', (value) {
                  _pendingApiKey = value;
                }, tokens, obscureText: true),
              ],
              tokens,
            ),
            const SizedBox(height: 24),
            _buildSection(
              context,
              'Advanced Configuration',
              [
                _buildSlider(context, 'Temperature', widget.provider.config?['temperature'] ?? 0.7, 0.0, 2.0, (value) {
                  setState(() {
                    _pendingTemperature = value;
                  });
                }, tokens),
                const SizedBox(height: 16),
                _buildSlider(context, 'Max Tokens', (widget.provider.config?['maxTokens'] ?? 2048).toDouble(), 100, 8192, (value) {
                  setState(() {
                    _pendingMaxTokens = value;
                  });
                }, tokens),
              ],
              tokens,
            ),
            const SizedBox(height: 24),
            _buildSection(
              context,
              'Model Management',
              [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Available Models',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(color: tokens.textPrimary),
                      ),
                    ),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (_lastFetchAt != null)
                          Text(
                            '上次刷新：${_formatTime(_lastFetchAt!)}',
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textSecondary),
                          ),
                        const SizedBox(width: 12),
                        _squareActionButton(
                          context,
                          icon: Icons.refresh,
                          tooltip: 'Fetch Models',
                          onTap: () async {
                            final service = AIServiceFactory.fromProvider(widget.provider);
                            final models = await service.fetchModels();
                            // 持久化到 Provider.settings
                            final controller = Get.find<ProviderController>();
                            final settings = Map<String, dynamic>.from(widget.provider.settings ?? {});
                            settings['models'] = models;
                            settings['modelsUpdatedAt'] = DateTime.now().toIso8601String();
                            final updated = widget.provider.copyWith(
                              settings: settings,
                              updatedAt: DateTime.now().toUtc(),
                            );
                            await controller.updateProvider(updated);
                            setState(() {
                              _models
                                ..clear()
                                ..addAll(models);
                              _lastFetchAt = DateTime.now();
                            });
                            if (models.isNotEmpty) {
                              Get.snackbar('成功', '已拉取 ${models.length} 个模型并保存');
                            } else {
                              Get.snackbar('提示', '未获取到模型');
                            }
                          },
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                _buildModelList(context, tokens),
              ],
              tokens,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildModelList(BuildContext context, LobeTokens tokens) {
    if (_models.isEmpty) {
      return Container(
        padding: EdgeInsets.all(UIKit.spaceSm(context)),
        decoration: BoxDecoration(
          color: tokens.bgLevel3,
          borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
          border: Border.all(color: UIKit.dividerColor(context), width: UIKit.dividerThickness),
        ),
        child: Text('暂无模型数据，点击右侧按钮拉取', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textSecondary)),
      );
    }
    return Container(
      decoration: BoxDecoration(
        color: tokens.bgLevel3,
        borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
        border: Border.all(color: UIKit.dividerColor(context), width: UIKit.dividerThickness),
      ),
      child: ListView.separated(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: _models.length,
        separatorBuilder: (_, __) => Divider(height: 1, thickness: 1, color: UIKit.dividerColor(context)),
        itemBuilder: (_, i) {
          final m = _models[i];
          return ListTile(
            dense: true,
            title: Text(m, style: TextStyle(color: tokens.textPrimary)),
            leading: const Icon(Icons.smart_toy_outlined, size: 18),
          );
        },
      ),
    );
  }

  String _formatTime(DateTime dt) {
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    final s = dt.second.toString().padLeft(2, '0');
    return '$h:$m:$s';
  }

  // 统一为搜索框后的方形风格按钮
  Widget _squareActionButton(
    BuildContext context, {
    required IconData icon,
    required VoidCallback? onTap,
    String? tooltip,
  }) {
    final theme = Theme.of(context);
    final tokens = theme.extension<LobeTokens>();
    final bg = tokens?.bgLevel3 ?? theme.colorScheme.surface;
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
        child: Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
            border: Border.all(color: UIKit.dividerColor(context), width: UIKit.dividerThickness),
          ),
          child: Center(
            child: Icon(icon, size: 18, color: theme.colorScheme.onSurfaceVariant),
          ),
        ),
      ),
    );
  }

  Widget _buildSection(BuildContext context, String title, List<Widget> children, LobeTokens tokens) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(color: tokens.textPrimary, fontWeight: FontWeight.bold)),
        const SizedBox(height: 16),
        ...children,
      ],
    );
  }

  Widget _buildTextField(BuildContext context, String label, String initialValue, ValueChanged<String> onChanged, LobeTokens tokens, {bool obscureText = false}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: tokens.textSecondary)),
        const SizedBox(height: 8),
        TextFormField(
          initialValue: initialValue,
          obscureText: obscureText,
          style: TextStyle(color: tokens.textPrimary),
          decoration: InputDecoration(
            filled: true,
            fillColor: tokens.bgLevel3,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
              borderSide: BorderSide.none,
            ),
          ),
          onChanged: onChanged,
        ),
      ],
    );
  }

  Widget _buildSlider(BuildContext context, String label, double value, double min, double max, ValueChanged<double> onChanged, LobeTokens tokens) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: tokens.textSecondary)),
        Slider(
          value: value,
          min: min,
          max: max,
          divisions: (max - min).toInt(),
          label: value.toStringAsFixed(2),
          onChanged: onChanged,
        ),
      ],
    );
  }
}