import 'package:desktop/pages/settings/ai_service_provider_page.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:desktop/models/ai_model_simple.dart';
import 'package:desktop/providers/model_provider.dart';

class AgentSelector extends StatelessWidget {
  const AgentSelector({super.key});

  @override
  Widget build(BuildContext context) {
    final modelProvider = Provider.of<AIModelProvider>(context);
    final currentModel = modelProvider.selectedModel;
    
    if (currentModel == null) {
      return const SizedBox.shrink();
    }

    return PopupMenuButton<dynamic>(
      itemBuilder: (context) {
        // Correctly type the list from the start by providing a type argument to map().
        // This ensures the list is `List<PopupMenuEntry<dynamic>>` and can hold different menu item types.
        List<PopupMenuEntry<dynamic>> items = modelProvider.availableModels.map<PopupMenuEntry<dynamic>>((model) {
          return PopupMenuItem<ModelCapability>(
            value: model,
            child: Text(model.displayName),
          );
        }).toList();

        // Add a divider and settings option
        items.add(const PopupMenuDivider());
        items.add(
          const PopupMenuItem<String>(
            value: 'settings',
            child: Row(
              children: [
                Icon(Icons.settings, size: 18),
                SizedBox(width: 8),
                Text('Settings'),
              ],
            ),
          ),
        );

        return items;
      },
      onSelected: (value) {
        if (value is ModelCapability) {
          modelProvider.selectModel(value);
        } else if (value == 'settings') {
          Navigator.of(context).push(MaterialPageRoute(
            builder: (context) => const AiServiceProviderPage(),
          ));
        }
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.grey.shade100,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(currentModel.displayName, style: const TextStyle(fontWeight: FontWeight.w500)),
            const SizedBox(width: 4),
            const Icon(Icons.arrow_drop_down, size: 20),
          ],
        ),
      ),
    );
  }
}