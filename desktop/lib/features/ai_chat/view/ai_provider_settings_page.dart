import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_provider_settings_controller.dart';

class AIProviderSettingsPage extends GetView<AIProviderSettingsController> {
  const AIProviderSettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    Get.put(AIProviderSettingsController());
    final theme = Theme.of(context);
    final tokens = theme.extension<LobeTokens>()!;

    return Scaffold(
      body: Row(
        children: [
          // Left Pane (Provider List)
          Container(
            width: 280,
            color: tokens.bgLevel2,
            child: Obx(() => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: TextField(
                        decoration: InputDecoration(
                          hintText: 'Search Providers...',
                          prefixIcon: const Icon(Icons.search),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: BorderSide.none,
                          ),
                          filled: true,
                          fillColor: tokens.bgLevel3,
                          contentPadding: EdgeInsets.zero,
                        ),
                      ),
                    ),
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                      child: Text('Enabled', style: TextStyle(fontWeight: FontWeight.bold)),
                    ),
                    ...controller.enabledProviders.map((provider) => ListTile(
                          leading: provider.icon,
                          title: Text(provider.name),
                          selected: controller.selectedProvider.value?.id == provider.id,
                          selectedTileColor: tokens.menuSelected,
                          onTap: () => controller.selectProvider(provider),
                          trailing: const Icon(Icons.circle, color: Colors.green, size: 12),
                        )),
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                      child: Text('Disabled', style: TextStyle(fontWeight: FontWeight.bold)),
                    ),
                    ...controller.disabledProviders.map((provider) => ListTile(
                          leading: provider.icon,
                          title: Text(provider.name),
                          selected: controller.selectedProvider.value?.id == provider.id,
                          selectedTileColor: tokens.menuSelected,
                          onTap: () => controller.selectProvider(provider),
                        )),
                  ],
                )),
          ),
          const VerticalDivider(width: 1),
          // Right Pane (Settings)
          Expanded(
            child: Container(
              color: tokens.bgLevel1,
              child: Obx(() {
                final provider = controller.selectedProvider.value;
                if (provider == null) {
                  return const Center(child: Text('Select a provider'));
                }
                return provider.buildSettings(context);
              }),
            ),
          ),
        ],
      ),
    );
  }
}