import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/core/components/frame_action_combo.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/provider.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/create_provider_dialog.dart';
import 'package:peers_touch_desktop/features/ai_chat/widgets/provider_detail_panel.dart';

class ProviderSettingsPage extends GetView<ProviderController> {
  const ProviderSettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    Get.put(ProviderController());
    final tokens = Theme.of(context).extension<LobeTokens>()!;

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
                      'Select a provider to configure',
                      style: TextStyle(color: tokens.textSecondary),
                    ),
                  );
                }
                return ProviderDetailPanel(provider: provider);
              }),
            ),
          ],
        );
      }),
    );
  }

  Widget _buildSearchAndAdd(BuildContext context, LobeTokens tokens) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: FrameActionCombo(
        hintText: '搜索助手',
        prefixIcon: Icons.search,
        onAction: () => _showAddProviderDialog(context, tokens),
        actionIcon: Icons.add,
      ),
    );
  }

  Widget _buildProviderList(BuildContext context, ProviderController controller, LobeTokens tokens) {
    final enabledProviders = controller.providers.where((p) => p.enabled).toList();
    final disabledProviders = controller.providers.where((p) => !p.enabled).toList();

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      children: [
        if (enabledProviders.isNotEmpty)
          ..._buildProviderGroup(context, 'Enabled', enabledProviders, controller, tokens),
        if (disabledProviders.isNotEmpty)
          ..._buildProviderGroup(context, 'Disabled', disabledProviders, controller, tokens),
      ],
    );
  }

  List<Widget> _buildProviderGroup(
    BuildContext context,
    String title,
    List<Provider> providers,
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
              leading: Icon(_getProviderIcon(provider.sourceType), color: tokens.textSecondary, size: 20),
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
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.cloud_off_outlined, size: 64, color: Colors.grey),
          const SizedBox(height: 16),
          Text(
            'No AI providers configured',
            style: Theme.of(context).textTheme.titleLarge?.copyWith(color: tokens.textSecondary),
          ),
          const SizedBox(height: 8),
          Text(
            'Add your first AI service provider to get started',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: tokens.textTertiary),
          ),
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: () => _showAddProviderDialog(context, tokens),
            icon: const Icon(Icons.add),
            label: const Text('Add Provider'),
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