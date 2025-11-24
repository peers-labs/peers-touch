import 'dart:convert';

import 'package:flutter/material.dart';
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
        title: Text(provider.name, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold), overflow: TextOverflow.ellipsis),
        automaticallyImplyLeading: false,
        actions: [
          LayoutBuilder(
            builder: (context, constraints) {
              return Obx(() {
                // 从控制器获取当前 provider 的启用状态
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
                      // TODO: Implement provider enable/disable logic
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
              Obx(() => _buildValueField(
                    context,
                    controller.isApiKeyObscured.value ? '••••••••••••••••••••••••' : (settings['apiKey'] ?? ''),
                    obscureText: controller.isApiKeyObscured.value,
                    suffixIcon: Icons.visibility,
                    onSuffixIconTap: () => controller.toggleApiKeyVisibility(),
                  )),
            ),
            const SizedBox(height: 24),
            _buildDetailRow(
              context,
              'API Proxy URL',
              'Must include http(s)://',
              _buildValueField(
                context,
                settings['proxyUrl'] ?? '',
                suffixIcon: Icons.sync, // Placeholder icon
                onSuffixIconTap: () {},
              ),
            ),
            const SizedBox(height: 24),
            _buildClientRequestModeSwitch(context, controller, tokens),
            const SizedBox(height: 24),
            _buildDetailRow(
              context,
              'Connectivity Check',
              'Test if the API Key and proxy URL are correctly filled',
              _buildConnectivityCheck(context, settings['checkModel'] ?? ''),
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
          onPressed: () {},
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
                controller.isClientRequestMode.value = value;
              },
            )),
      ],
    );
  }

  Widget _buildModelManagementSection(BuildContext context, ProviderController controller, LobeTokens tokens) {
    return DefaultTabController(
      length: 2,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Model List', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
              Row(
                children: [
                  SizedBox(
                    width: 150,
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
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton.icon(
                    onPressed: () {},
                    icon: const Icon(Icons.sync, size: 16),
                    label: const Text('Fetch models'),
                    style: UIKit.primaryButtonStyle(context).copyWith(
                      padding: MaterialStateProperty.all(const EdgeInsets.symmetric(horizontal: 16, vertical: 12)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    onPressed: () {},
                    icon: const Icon(Icons.more_horiz),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          TabBar(
            tabs: const [
              Tab(text: 'All (1)'),
              Tab(text: 'Chat (1)'),
            ],
            labelColor: tokens.textPrimary,
            unselectedLabelColor: tokens.textSecondary,
            indicatorColor: tokens.brandAccent,
            indicatorSize: TabBarIndicatorSize.label,
            isScrollable: true,
          ),
          const SizedBox(height: 16),
          Text('Enabled', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textSecondary)),
          const SizedBox(height: 8),
          _buildModelListItem(context, tokens, 'ep-20251014145207-5xzgh', 'ep-20251014145207-5xzgh', true),
          const SizedBox(height: 32),
          Center(
            child: Text(
              'More models are planned to be added, stay tuned',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.textTertiary),
            ),
          ),
        ],
      ),
    );
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
          Icon(Icons.apps, size: 24, color: tokens.brandAccent), // Placeholder icon
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
            onChanged: (value) {},
          ),
        ],
      ),
    );
  }
}