import 'package:peers_touch_desktop/modules/settings/ai_service_provider_view.dart';
import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/model/ai_model_simple.dart';
import 'package:peers_touch_desktop/provider/model_provider.dart';

class AgentSelector extends StatelessWidget {
  const AgentSelector({super.key});

  // 获取 provider 的显示名称
  String _getProviderDisplayName(ModelProvider provider) {
    switch (provider) {
      case ModelProvider.openai:
        return 'OpenAI';
      case ModelProvider.google:
        return 'Google';
      case ModelProvider.anthropic:
        return 'Anthropic';
      case ModelProvider.moonshot:
        return 'Moonshot';
      case ModelProvider.ollama:
        return 'Ollama';
      case ModelProvider.custom:
        return 'Custom';
      default:
        return 'Unknown';
    }
  }

  // 按 provider 分组模型
  Map<ModelProvider, List<ModelCapability>> _groupModelsByProvider(List<ModelCapability> models) {
    final Map<ModelProvider, List<ModelCapability>> grouped = {};
    for (final model in models) {
      if (!grouped.containsKey(model.provider)) {
        grouped[model.provider] = [];
      }
      grouped[model.provider]!.add(model);
    }
    return grouped;
  }

  @override
  Widget build(BuildContext context) {
    final modelProvider = Get.find<AIModelProvider>();
    final currentModel = modelProvider.selectedModel;
    
    if (currentModel == null) {
      return const SizedBox.shrink();
    }

    final groupedModels = _groupModelsByProvider(modelProvider.availableModels);

    return PopupMenuButton<dynamic>(
      itemBuilder: (context) {
        List<PopupMenuEntry<dynamic>> items = [];

        // 为每个 provider 创建子菜单
        for (final entry in groupedModels.entries) {
          final provider = entry.key;
          final models = entry.value;
          final providerName = _getProviderDisplayName(provider);

          // 添加 provider 标题
          items.add(
            PopupMenuItem<String>(
              enabled: false,
              child: Text(
                providerName,
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  color: Colors.grey,
                ),
              ),
            ),
          );

          // 添加该 provider 下的所有模型
          for (final model in models) {
            items.add(
              PopupMenuItem<ModelCapability>(
                value: model,
                child: Padding(
                  padding: const EdgeInsets.only(left: 16.0),
                  child: Text(model.displayName),
                ),
              ),
            );
          }

          // 如果不是最后一个 provider，添加分隔线
          if (entry != groupedModels.entries.last) {
            items.add(const PopupMenuDivider());
          }
        }

        // 添加设置选项
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