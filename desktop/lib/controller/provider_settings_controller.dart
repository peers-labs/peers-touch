import 'package:get/get.dart';

class ProviderSettingsController extends GetxController {
  final selectedProviderId = RxnString();

  final providers = <ProviderModel>[
    ProviderModel(
      id: 'ollama-default',
      name: 'Ollama',
      description: 'Ollama 是一个开源的本地 AI 模型运行平台',
      logo: '🦙', // 使用 emoji 作为临时图标
      enabled: true,
    ),
    ProviderModel(
      id: 'openai-gpt',
      name: 'OpenAI GPT',
      description: 'OpenAI 的 GPT 系列模型',
      logo: '🤖',
      enabled: false,
    ),
    ProviderModel(
      id: 'anthropic-claude',
      name: 'Anthropic Claude',
      description: 'Anthropic 的 Claude 系列模型',
      logo: '🧠',
      enabled: false,
    ),
    ProviderModel(
      id: 'google-gemini',
      name: 'Google Gemini',
      description: 'Google 的 Gemini 系列模型',
      logo: '💎',
      enabled: false,
    ),
  ].obs;

  void selectProvider(String id) {
    selectedProviderId.value = id;
  }

  void toggleProvider(String id, bool value) {
    final provider = providers.firstWhere((p) => p.id == id);
    provider.enabled = value;
    providers.refresh();
  }

  ProviderModel? get selectedProvider {
    if (selectedProviderId.value == null) return null;
    return providers.firstWhere((p) => p.id == selectedProviderId.value);
  }
}

// Provider 数据模型
class ProviderModel {
  final String id;
  final String name;
  final String description;
  final String logo;
  bool enabled;

  ProviderModel({
    required this.id,
    required this.name,
    required this.description,
    required this.logo,
    required this.enabled,
  });
}