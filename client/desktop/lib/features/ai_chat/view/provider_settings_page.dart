import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart' as base;
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/create_provider_dialog.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/provider_detail_panel.dart';
import 'package:peers_touch_desktop/features/settings/widgets/settings_panel_card.dart';

class ProviderSettingsPage extends GetView<ProviderController> {
  const ProviderSettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    final l = AppLocalizations.of(context)!;

    return Scaffold(
      backgroundColor: tokens.bgLevel1,
      body: Obx(() {
        if (controller.isLoading.value) {
          return const Center(child: CircularProgressIndicator());
        }

        if (controller.providers.isEmpty) {
          return _buildEmptyState(context, tokens);
        }

        return Row(
          children: [
            // Left Pane (Provider List)
            Container(
              width: 280,
              color: tokens.bgLevel2,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildSearchAndAdd(context, tokens),
                  Expanded(
                    child: _buildProviderList(context, controller, tokens),
                  ),
                ],
              ),
            ),
            const VerticalDivider(width: 1, thickness: 1),
            // Right Pane (Details)
            Expanded(
              child: Obx(() {
                final provider = controller.currentProvider.value;
                if (provider == null) {
                  return Center(
                    child: Text(
                      l.selectProviderToConfigure,
                      style: TextStyle(color: tokens.textSecondary),
                    ),
                  );
                }
                // 统一设置卡片包装，并提供刷新按钮
                return SettingsPanelCard(
                  title: l.providerSettings,
                  subtitle: l.providerSettingsSubtitle,
                  onRefresh: () => controller.refresh(),
                  actions: [
                    IconButton(onPressed: () => controller.refresh(), icon: const Icon(Icons.refresh), tooltip: l.refresh),
                  ],
                  child: ProviderDetailPanel(provider: provider),
                );
              }),
            ),
          ],
        );
      }),
    );
  }

  Widget _buildSearchAndAdd(BuildContext context, LobeTokens tokens) {
    final l = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              decoration: UIKit.inputDecoration(context).copyWith(
                hintText: l.searchProviders,
                prefixIcon: const Icon(Icons.search),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => _showAddProviderDialog(context, tokens),
            tooltip: l.addProvider,
            style: UIKit.primaryButtonStyle(context),
          ),
        ],
      ),
    );
  }

  Widget _buildProviderList(BuildContext context, ProviderController controller, LobeTokens tokens) {
    final l = AppLocalizations.of(context)!;
    final enabledProviders = controller.providers.where((p) => p.enabled).toList();
    final disabledProviders = controller.providers.where((p) => !p.enabled).toList();

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      children: [
        if (enabledProviders.isNotEmpty)
          ..._buildProviderGroup(context, l.enabledGroup, enabledProviders, controller, tokens),
        if (disabledProviders.isNotEmpty)
          ..._buildProviderGroup(context, l.disabledGroup, disabledProviders, controller, tokens),
      ],
    );
  }

  List<Widget> _buildProviderGroup(
    BuildContext context,
    String title,
    List<base.Provider> providers,
    ProviderController controller,
    LobeTokens tokens,
  ) {
    return [
      Padding(
        padding: const EdgeInsets.only(left: 16.0, top: 16.0, bottom: 8.0),
        child: Text(title, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: tokens.textTertiary)),
      ),
      ...providers.map((provider) {
        return Obx(() => ListTile(
              leading: _buildProviderIcon(context, provider, 20),
              title: Text(provider.name, style: TextStyle(color: tokens.textPrimary, fontSize: 14)),
              selected: controller.currentProvider.value?.id == provider.id,
              selectedTileColor: tokens.menuSelected,
              onTap: () => controller.setCurrentProvider(provider.id),
              trailing: provider.enabled ? const Icon(Icons.circle, color: Colors.green, size: 10) : null,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(UIKit.radiusSm(context))),
              dense: true,
            ));
      }).toList(),
    ];
  }

  Widget _buildEmptyState(BuildContext context, LobeTokens tokens) {
    final l = AppLocalizations.of(context)!;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.cloud_off_outlined, size: 64, color: Colors.grey),
          const SizedBox(height: 16),
          Text(
            l.noProvidersConfigured,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(color: tokens.textSecondary),
          ),
          const SizedBox(height: 8),
          Text(
            l.addFirstProvider,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: tokens.textTertiary),
          ),
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: () => _showAddProviderDialog(context, tokens),
            icon: const Icon(Icons.add),
            label: Text(l.addProvider),
            style: UIKit.primaryButtonStyle(context),
          ),
        ],
      ),
    );
  }

  void _showAddProviderDialog(BuildContext context, LobeTokens tokens) {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: tokens.bgLevel2,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
        ),
        child: const CreateProviderForm(),
      ),
    );
  }

  Widget _buildProviderIcon(BuildContext context, base.Provider provider, double size) {
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
    
    IconData iconData;
    switch (s) {
      case 'openai':
        iconData = Icons.smart_toy_outlined;
        break;
      case 'ollama':
        iconData = Icons.computer_outlined;
        break;
      default:
        iconData = Icons.cloud_outlined;
    }
    
    final tokens = Theme.of(context).extension<LobeTokens>()!;
    return Icon(iconData, color: tokens.textSecondary, size: size);
  }
}
