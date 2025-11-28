import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart' as base;
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/add_model_dialog.dart';

class ProviderDetailPanel extends StatelessWidget {
  final base.Provider provider;

  const ProviderDetailPanel({super.key, required this.provider});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<ProviderController>();
    final tokens = Theme.of(context).extension<LobeTokens>()!;

    final settings = provider.settingsJson.isNotEmpty
        ? jsonDecode(provider.settingsJson) as Map<String, dynamic>
        : {};

    return Scaffold(
      backgroundColor: tokens.bgLevel1,
      appBar: AppBar(
        backgroundColor: tokens.bgLevel1,
        elevation: 0,
        centerTitle: false,
        title: GestureDetector(
          onDoubleTap: () async {
            final ctl = Get.find<ProviderController>();
            final tc = TextEditingController(text: provider.name);
            await showDialog(
              context: context,
              builder: (ctx) => AlertDialog(
                title: const Text('Rename Provider'),
                content: TextField(controller: tc, decoration: const InputDecoration(hintText: 'Enter new name')),
                actions: [
                  TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancel')),
                  ElevatedButton(onPressed: () async { await ctl.updateProviderName(provider.id, tc.text.trim()); Navigator.of(ctx).pop(); }, child: const Text('Save')),
                ],
              ),
            );
          },
          child: Text(provider.name, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold), overflow: TextOverflow.ellipsis),
        ),
        automaticallyImplyLeading: false,
        actions: [
          IconButton(
            onPressed: () => Get.find<ProviderController>().deleteProvider(provider.id),
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Delete Provider',
          ),
          LayoutBuilder(
            builder: (context, constraints) {
              return Obx(() {
                final providers = Get.find<ProviderController>().providers;
                final isEnabled = providers.isNotEmpty
                    ? providers.firstWhere((p) => p.id == provider.id,
                        orElse: () => provider).enabled
                    : provider.enabled;
                
                return SizedBox(
                  width: constraints.maxWidth > 400 ? null : 60,
                  child: Switch(
                    value: isEnabled,
                    onChanged: (value) {
                      Get.find<ProviderController>().toggleEnabled(value);
                    },
                  ),
                );
              });
            },
          ),
          const SizedBox(width: 16),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.only(top: 24, left: 24, right: 24),
        child: ListView(
          children: [
            _buildDetailRow(
              context,
              'API Key',
              'Please enter your ${provider.name} API Key',
              Obx(() {
                final value = (settings['apiKey'] ?? '').toString();
                return _buildEditableField(
                  context,
                  initialValue: value,
                  obscureText: controller.isApiKeyObscured.value,
                  suffixIcon: Icons.visibility,
                  onSuffixIconTap: () => controller.toggleApiKeyVisibility(),
                  onSubmitted: (v) => controller.updateField('apiKey', v),
                );
              }),
            ),
            const SizedBox(height: 24),
            _buildDetailRow(
              context,
              'API Proxy URL',
              'Must include http(s)://',
              _buildEditableField(
                context,
                initialValue: (settings['proxyUrl'] ?? '').toString(),
                suffixIcon: Icons.sync,
                onSuffixIconTap: () => Get.find<ProviderController>().updateField('proxyUrl', (settings['defaultProxyUrl'] ?? settings['proxyUrl'] ?? '').toString()),
                onSubmitted: (v) => controller.updateField('proxyUrl', v),
              ),
            ),
            const SizedBox(height: 24),
            _buildClientRequestModeSwitch(context, controller, tokens),
            const SizedBox(height: 24),
            _buildShowTokensSwitch(context, tokens),
            const SizedBox(height: 24),
            _buildDetailRow(
              context,
              'Connectivity Check',
              'Test if the API Key and proxy URL are correctly filled',
              _buildConnectivityCheckEditable(context, provider, settings['checkModel'] ?? ''),
            ),
            const SizedBox(height: 16),
            _buildEncryptionNotice(context, tokens),
            const SizedBox(height: 48),
            _buildModelManagementSection(context, controller, tokens),
          ],
        ),
      ),
    );
  }

  Widget _buildDetailRow(BuildContext context, String title, String subtitle, Widget valueWidget) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 200, // Fixed width for the labels column
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text(subtitle, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textSecondary)),
            ],
          ),
        ),
        const SizedBox(width: 16),
        Expanded(child: valueWidget),
      ],
    );
  }

  Widget _buildValueField(BuildContext context, String value, {bool obscureText = false, IconData? suffixIcon, VoidCallback? onSuffixIconTap}) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: tokens.bgLevel2,
        borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              value,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontFamily: 'monospace'),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (suffixIcon != null)
            InkWell(
              onTap: onSuffixIconTap,
              child: Icon(suffixIcon, color: tokens.textSecondary, size: 18),
            ),
        ],
      ),
    );
  }

  Widget _buildEditableField(BuildContext context, {required String initialValue, bool obscureText = false, IconData? suffixIcon, VoidCallback? onSuffixIconTap, required ValueChanged<String> onSubmitted}) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    final controller = TextEditingController(text: initialValue);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: tokens.bgLevel2,
        borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              obscureText: obscureText,
              decoration: const InputDecoration(border: InputBorder.none, isDense: true),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontFamily: 'monospace'),
              onSubmitted: onSubmitted,
            ),
          ),
          if (suffixIcon != null)
            InkWell(
              onTap: onSuffixIconTap,
              child: Icon(suffixIcon, color: tokens.textSecondary, size: 18),
            ),
        ],
      ),
    );
  }

  Widget _buildConnectivityCheck(BuildContext context, String checkModel) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    return Row(
      children: [
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: tokens.bgLevel2,
              borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
            ),
            child: Text(checkModel, overflow: TextOverflow.ellipsis),
          ),
        ),
        const SizedBox(width: 8),
        ElevatedButton(
          onPressed: () => Get.find<ProviderController>().testProviderConnection(provider.id),
          style: UIKit.primaryButtonStyle(context).copyWith(
            padding: MaterialStateProperty.all(const EdgeInsets.symmetric(horizontal: 16, vertical: 12)),
          ),
          child: const Text('Check'),
        ),
      ],
    );
  }

  Widget _buildConnectivityCheckEditable(BuildContext context, base.Provider provider, String checkModel) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    final ctl = Get.find<ProviderController>();
    final tc = TextEditingController(text: checkModel);
    return Row(
      children: [
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: tokens.bgLevel2,
              borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
            ),
            child: TextField(
              controller: tc,
              decoration: const InputDecoration(border: InputBorder.none, isDense: true),
              onSubmitted: (v) => ctl.updateField('checkModel', v),
            ),
          ),
        ),
        const SizedBox(width: 8),
        ElevatedButton(
          onPressed: () => ctl.testProviderConnection(provider.id),
          style: UIKit.primaryButtonStyle(context).copyWith(
            padding: MaterialStateProperty.all(const EdgeInsets.symmetric(horizontal: 16, vertical: 12)),
          ),
          child: const Text('Check'),
        ),
        const SizedBox(width: 8),
        Obx(() {
          final s = ctl.connectionStatus.value;
          switch (s) {
            case 'checking':
              return Row(children: [
                const SizedBox(
                  height: 16,
                  width: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                const SizedBox(width: 6),
                Text('Checking...', style: Theme.of(context).textTheme.bodySmall),
              ]);
            case 'success':
              return Row(children: [
                Icon(Icons.check_circle, color: Colors.green, size: 16),
                const SizedBox(width: 6),
                Text('Connected', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.green)),
              ]);
            case 'failure':
              return Row(children: [
                Icon(Icons.error_outline, color: Colors.red, size: 16),
                const SizedBox(width: 6),
                Text('Failed', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.red)),
              ]);
            default:
              return const SizedBox.shrink();
          }
        }),
      ],
    );
  }

  Widget _buildEncryptionNotice(BuildContext context, LobeTokens tokens) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        Icon(Icons.lock_outline, size: 12, color: tokens.textTertiary),
        const SizedBox(width: 4),
        Text(
          'Your key and proxy URL will be encrypted using AES-GCM encryption algorithm',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textTertiary),
        ),
      ],
    );
  }

  Widget _buildClientRequestModeSwitch(BuildContext context, ProviderController controller, LobeTokens tokens) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 200,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Use Client Request Mode', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text(
                'Client will initiate session requests directly from the browser, which can improve response speed',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textSecondary),
              ),
            ],
          ),
        ),
        const SizedBox(width: 16),
        Obx(() => Switch(
              value: controller.isClientRequestMode.value,
              onChanged: (value) {
                controller.setClientRequestMode(value);
              },
            )),
      ],
    );
  }

  Widget _buildShowTokensSwitch(BuildContext context, LobeTokens tokens) {
    final storage = Get.find<LocalStorage>();
    final initial = storage.get<bool>(AIConstants.showTokens) ?? false;
    final rx = false.obs;
    rx.value = initial;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 200,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Show Token Counter', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text(
                '在聊天消息下方显示 Token 胶囊',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textSecondary),
              ),
            ],
          ),
        ),
        const SizedBox(width: 16),
        Obx(() => Switch(
              value: rx.value,
              onChanged: (v) {
                rx.value = v;
                storage.set(AIConstants.showTokens, v);
              },
            )),
      ],
    );
  }

  Widget _buildModelManagementSection(BuildContext context, ProviderController controller, LobeTokens tokens) {
    final provider = this.provider;
    final settings = provider.settingsJson.isNotEmpty ? (jsonDecode(provider.settingsJson) as Map<String, dynamic>) : {};
    final models = List<String>.from((settings['models'] ?? <String>[]) as List);
    final enabled = List<String>.from((settings['enabledModels'] ?? <String>[]) as List);
    final List<dynamic> infos = List<dynamic>.from(settings['modelInfos'] ?? <dynamic>[]);
    final Map<String, String> idToDisplayName = {
      for (final e in infos.whereType<Map>())
        (e['id']?.toString() ?? ''): (e['displayName']?.toString() ?? '')
    }..removeWhere((k, v) => k.isEmpty);
    return Obx(() {
      final keyword = controller.modelSearchText.value.toLowerCase();
      final filteredBase = keyword.isEmpty ? models : models.where((m) => m.toLowerCase().contains(keyword)).toList();
      final tab = controller.modelTabIndex.value;
      final filtered = tab == 1
          ? filteredBase.where((m) => enabled.isEmpty ? true : enabled.contains(m)).toList()
          : filteredBase;
      final allCount = filteredBase.length;
      final enabledCount = filteredBase.where((m) => enabled.isEmpty ? true : enabled.contains(m)).length;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Model List', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
              Row(
                children: [
                  SizedBox(
                    width: 180,
                    child: TextField(
                      decoration: InputDecoration(
                        hintText: 'Search Models...',
                        prefixIcon: Icon(Icons.search, size: 18),
                        isDense: true,
                        filled: true,
                        fillColor: tokens.bgLevel2,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
                          borderSide: BorderSide.none,
                        ),
                      ),
                      onChanged: controller.filterModels,
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton.icon(
                    onPressed: () => Get.find<ProviderController>().fetchProviderModels(provider.id),
                    icon: const Icon(Icons.sync, size: 16),
                    label: const Text('Fetch'),
                    style: UIKit.primaryButtonStyle(context).copyWith(
                      padding: MaterialStateProperty.all(const EdgeInsets.symmetric(horizontal: 16, vertical: 12)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton.icon(
                    onPressed: () {
                      showDialog(context: context, builder: (_) => AddModelDialog(provider: provider));
                    },
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Add'),
                    style: UIKit.primaryButtonStyle(context).copyWith(
                      padding: MaterialStateProperty.all(const EdgeInsets.symmetric(horizontal: 16, vertical: 12)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(onPressed: () {}, icon: const Icon(Icons.more_horiz)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              GestureDetector(
                onTap: () => controller.setModelTabIndex(0),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: controller.modelTabIndex.value == 0 ? tokens.bgLevel3 : tokens.bgLevel2,
                    borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                    border: Border.all(color: controller.modelTabIndex.value == 0 ? tokens.brandAccent : Colors.transparent),
                  ),
                  child: Text('All ($allCount)', style: Theme.of(context).textTheme.bodySmall),
                ),
              ),
              const SizedBox(width: 8),
              GestureDetector(
                onTap: () => controller.setModelTabIndex(1),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: controller.modelTabIndex.value == 1 ? tokens.bgLevel3 : tokens.bgLevel2,
                    borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                    border: Border.all(color: controller.modelTabIndex.value == 1 ? tokens.brandAccent : Colors.transparent),
                  ),
                  child: Text('Enabled ($enabledCount)', style: Theme.of(context).textTheme.bodySmall),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text('Enabled', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textSecondary)),
          const SizedBox(height: 8),
          for (final m in filtered)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _buildModelListItem(
                context,
                tokens,
                idToDisplayName[m]?.isNotEmpty == true ? idToDisplayName[m]! : m,
                m,
                enabled.isEmpty ? true : enabled.contains(m),
              ),
            ),
          const SizedBox(height: 16),
          Center(
            child: Text('More models are planned to be added, stay tuned', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textTertiary)),
          ),
        ],
      );
    });
  }

  Widget _buildModelListItem(BuildContext context, LobeTokens tokens, String name, String id, bool isEnabled) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: tokens.bgLevel2,
        borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
      ),
      child: Row(
        children: [
          _buildModelIcon(context, id, 24),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                GestureDetector(
                  onDoubleTap: () async {
                    await Clipboard.setData(ClipboardData(text: name));
                    Get.snackbar('成功', '已复制名称');
                  },
                  child: Text(name, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold)),
                ),
                GestureDetector(
                  onDoubleTap: () async {
                    await Clipboard.setData(ClipboardData(text: id));
                    Get.snackbar('成功', '已复制模型ID');
                  },
                  child: Text(id, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textSecondary)),
                ),
              ],
            ),
          ),
          Row(children: [
            Switch(
              value: isEnabled,
              onChanged: (value) => Get.find<ProviderController>().toggleModelEnabled(id, value),
            ),
            IconButton(
              tooltip: '删除模型',
              icon: const Icon(Icons.delete_outline),
              onPressed: () => Get.find<ProviderController>().deleteModel(id),
            ),
          ]),
        ],
      ),
    );
  }

  Widget _buildModelIcon(BuildContext context, String modelId, double size) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    final s = provider.sourceType.toLowerCase();
    String? assetPath;
    if (s == 'openai' || s.startsWith('openai_style')) {
      final id = modelId.toLowerCase();
      if (id.contains('gpt-4o') || id.contains('omni') || id.contains('gpt-4.1')) {
        assetPath = 'assets/icons/ai-chat/openai.svg';
      } else {
        assetPath = 'assets/icons/ai-chat/openai-text.svg';
      }
    } else if (s == 'ollama') {
      final id = modelId.toLowerCase();
      if (id.contains('llava') || id.contains('vision') || id.contains('phi-3-vision') || id.contains('llama3.2')) {
        assetPath = 'assets/icons/ai-chat/ollama.svg';
      } else {
        assetPath = 'assets/icons/ai-chat/ollama-text.svg';
      }
    }

    if (assetPath != null) {
      return ClipOval(child: SvgPicture.asset(assetPath, width: size, height: size));
    }

    // Fallback: if provider.logo is an asset svg filename, use it
    final logo = provider.logo;
    if (logo.isNotEmpty && logo.toLowerCase().endsWith('.svg')) {
      final candidate = 'assets/icons/ai-chat/${logo.trim()}';
      return ClipOval(child: SvgPicture.asset(candidate, width: size, height: size));
    }

    return Icon(Icons.apps, size: size, color: tokens.brandAccent);
  }

  Widget _buildProviderLogo(BuildContext context, double size) {
    final s = provider.sourceType.toLowerCase();
    String? assetPath;
    if (['openai', 'anthropic', 'google', 'ollama', 'azure', 'cloudflare', 'qwen', 'volcengine'].contains(s)) {
      assetPath = 'assets/icons/ai-chat/$s.svg';
    }

    if (assetPath != null) {
      return ClipOval(
        child: SvgPicture.asset(assetPath, width: size, height: size),
      );
    }

    final logo = provider.logo;
    if (logo.isNotEmpty) {
      // If it's a known asset svg filename, load asset; else treat as URL
      if (logo.toLowerCase().endsWith('.svg')) {
        final path = 'assets/icons/ai-chat/${logo.trim()}';
        return ClipOval(child: SvgPicture.asset(path, width: size, height: size));
      } else {
        return ClipOval(
          child: Image.network(logo, width: size, height: size, errorBuilder: (ctx, _, __) {
            return Icon(Icons.apps, size: size, color: Theme.of(context).extension<LobeTokens>()!.brandAccent);
          }),
        );
      }
    }
    
    return Icon(Icons.apps, size: size, color: Theme.of(context).extension<LobeTokens>()!.brandAccent);
  }
}
