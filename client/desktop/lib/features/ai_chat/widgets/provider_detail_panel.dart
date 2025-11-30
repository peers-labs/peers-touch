import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart' as base;
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';

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

  Widget _buildModelManagementSection(BuildContext context, ProviderController controller, LobeTokens tokens) {
    final provider = this.provider;
    final settings = provider.settingsJson.isNotEmpty ? (jsonDecode(provider.settingsJson) as Map<String, dynamic>) : {};
    final models = List<String>.from((settings['models'] ?? <String>[]) as List);
    final enabled = List<String>.from((settings['enabledModels'] ?? <String>[]) as List);
    return Obx(() {
      final keyword = controller.modelSearchText.value.toLowerCase();
      final filtered = keyword.isEmpty ? models : models.where((m) => m.toLowerCase().contains(keyword)).toList();
      final enabledFiltered = filtered.where((m) => enabled.isEmpty ? true : enabled.contains(m)).toList();
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
                    label: const Text('Fetch models'),
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
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: tokens.bgLevel2, borderRadius: BorderRadius.circular(UIKit.radiusSm(context))),
                child: Text('All (${filtered.length})', style: Theme.of(context).textTheme.bodySmall),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: tokens.bgLevel2, borderRadius: BorderRadius.circular(UIKit.radiusSm(context))),
                child: Text('Enabled (${enabledFiltered.length})', style: Theme.of(context).textTheme.bodySmall),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text('Enabled', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textSecondary)),
          const SizedBox(height: 8),
          for (final m in filtered)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _buildModelListItem(context, tokens, m, m, enabled.isEmpty ? true : enabled.contains(m)),
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
                Text(name, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold)),
                Text(id, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textSecondary)),
              ],
            ),
          ),
          Switch(
            value: isEnabled,
            onChanged: (value) => Get.find<ProviderController>().toggleModelEnabled(id, value),
          ),
        ],
      ),
    );
  }

  Widget _buildModelIcon(BuildContext context, String modelId, double size) {
    // TODO: Support model-specific icons. Currently falling back to provider logo.
    // If we had assets like 'assets/icons/ai-chat/models/$modelId.svg', we would load them here.
    return _buildProviderLogo(context, size);
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

    final url = provider.logo;
    if (url.isNotEmpty) {
       return ClipOval(
        child: Image.network(url, width: size, height: size, errorBuilder: (ctx, _, __) {
          return Icon(Icons.apps, size: size, color: Theme.of(context).extension<LobeTokens>()!.brandAccent);
        }),
      );
    }
    
    return Icon(Icons.apps, size: size, color: Theme.of(context).extension<LobeTokens>()!.brandAccent);
  }
}
