import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';
import 'package:peers_touch_desktop/features/settings/controller/setting_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service_factory.dart';

/// AI Provider设置模块 - 演示业务模块设置注入
class AIProviderSettings {
  /// 获取AI Provider设置项
  static List<SettingItem> getSettings() {
    return [
      const SettingItem(
        id: 'ai_provider_header',
        title: 'AI服务提供商',
        type: SettingItemType.sectionHeader,
      ),
      SettingItem(
        id: 'provider_type',
        title: '提供商类型',
        description: '选择AI服务提供商（支持 OpenAI / Ollama）',
        icon: Icons.precision_manufacturing,
        type: SettingItemType.select,
        value: Get.find<LocalStorage>().get<String>(AIConstants.providerType) ?? 'OpenAI',
        options: const ['OpenAI', 'Ollama', 'Google', 'Anthropic', 'Moonshot', 'Custom'],
        onChanged: (value) {
          final storage = Get.find<LocalStorage>();
          final v = (value is String) ? value : (value?.toString() ?? 'OpenAI');
          storage.set(AIConstants.providerType, v);
          Get.snackbar('提示', '当前选择: $v');
          // 同步作用域默认模型到UI
          final controller = Get.find<SettingController>();
          final selectedModelKey = v == 'Ollama' ? AIConstants.selectedModelOllama : AIConstants.selectedModelOpenAI;
          final selectedModel = storage.get<String>(selectedModelKey);
          controller.updateSettingValue('module_ai_provider', 'model_selection', selectedModel);
          controller.refreshSections(); // 刷新整个设置页面以触发 isVisible 的重新计算
        },
      ),
      SettingItem(
        id: 'openai_api_key',
        title: 'OpenAI API密钥',
        description: '设置OpenAI API访问密钥',
        icon: Icons.key,
        type: SettingItemType.password,
        value: Get.find<LocalStorage>().get<String>(AIConstants.openaiApiKey) ?? '',
        placeholder: '请输入OpenAI API密钥',
        onChanged: (value) {
          final storage = Get.find<LocalStorage>();
          storage.set(AIConstants.openaiApiKey, value ?? '');
        },
        isVisible: (allItems) => allItems.firstWhere((i) => i.id == 'provider_type').value == 'OpenAI',
      ),
      SettingItem(
        id: 'openai_base_url',
        title: 'OpenAI基础URL',
        description: '设置OpenAI API基础URL（可选）',
        icon: Icons.link,
        type: SettingItemType.textInput,
        value: Get.find<LocalStorage>().get<String>(AIConstants.openaiBaseUrl) ?? AIConstants.defaultOpenAIBaseUrl,
        placeholder: '请输入OpenAI基础URL',
        onChanged: (value) {
          final storage = Get.find<LocalStorage>();
          storage.set(AIConstants.openaiBaseUrl, value ?? AIConstants.defaultOpenAIBaseUrl);
        },
        isVisible: (allItems) => allItems.firstWhere((i) => i.id == 'provider_type').value == 'OpenAI',
      ),
      // Ollama 配置项
      SettingItem(
        id: 'ollama_base_url',
        title: 'Ollama 接口代理地址',
        description: '必须包含 http(s)://；本地默认 http://localhost:11434',
        icon: Icons.link,
        type: SettingItemType.textInput,
        value: Get.find<LocalStorage>().get<String>(AIConstants.ollamaBaseUrl) ?? 'http://localhost:11434',
        placeholder: '例如 http://127.0.0.1:11434',
        onChanged: (value) {
          final storage = Get.find<LocalStorage>();
          storage.set(AIConstants.ollamaBaseUrl, value ?? 'http://localhost:11434');
        },
        isVisible: (allItems) => allItems.firstWhere((i) => i.id == 'provider_type').value == 'Ollama',
      ),
      SettingItem(
        id: 'ollama_client_side_mode',
        title: '使用客户端拉取模式',
        description: '浏览器直接请求 Ollama，提高响应速度',
        icon: Icons.speed,
        type: SettingItemType.toggle,
        value: false,
        onChanged: (value) {
          final storage = Get.find<LocalStorage>();
          storage.set(AIConstants.ollamaClientSideMode, value == true);
        },
      ),
      SettingItem(
        id: 'model_selection',
        title: '默认模型',
        description: '选择默认使用的AI模型',
        icon: Icons.smart_toy,
        type: SettingItemType.select,
        value: () {
          final storage = Get.find<LocalStorage>();
          final provider = storage.get<String>(AIConstants.providerType) ?? 'OpenAI';
          final key = provider == 'Ollama' ? AIConstants.selectedModelOllama : AIConstants.selectedModelOpenAI;
          return storage.get<String>(key);
        }(),
        options: const [],
        onChanged: (value) {
          final storage = Get.find<LocalStorage>();
          final provider = storage.get<String>(AIConstants.providerType) ?? 'OpenAI';
          final key = provider == 'Ollama' ? AIConstants.selectedModelOllama : AIConstants.selectedModelOpenAI;
          final v = (value is String) ? value : (value?.toString() ?? AIConstants.defaultOpenAIModel);
          storage.set(key, v);
        },
      ),
      SettingItem(
        id: 'fetch_models',
        title: '拉取模型',
        description: '根据当前提供商配置拉取可用模型',
        icon: Icons.refresh,
        type: SettingItemType.button,
        onTap: () async {
          final storage = Get.find<LocalStorage>();
          final provider = storage.get<String>(AIConstants.providerType) ?? 'OpenAI';
          final service = AIServiceFactory.fromName(provider);
          if (!service.isConfigured) {
            Get.snackbar('提示', provider == 'Ollama' ? '请先配置 Ollama 接口地址' : '请先配置 OpenAI API 密钥');
            return;
          }
          try {
            Get.snackbar('拉取模型', '从 $provider 拉取模型列表...');
            final models = await service.fetchModels();
            final controller = Get.find<SettingController>();
            // 更新下拉选项
            controller.updateSettingOptions('module_ai_provider', 'model_selection', models);
            // 如果当前没有选择值或值不在新列表中，则设置为第一个，并保存到作用域键
            final section = controller.sections.firstWhere(
              (s) => s.id == 'module_ai_provider',
              orElse: () => controller.sections.first,
            );
            final item = section.items.firstWhere(
              (i) => i.id == 'model_selection',
              orElse: () => const SettingItem(id: 'model_selection', title: '', type: SettingItemType.select),
            );
            final current = item.value?.toString();
            if (models.isNotEmpty && (current == null || !models.contains(current))) {
              controller.updateSettingValue('module_ai_provider', 'model_selection', models.first);
              final key = provider == 'Ollama' ? AIConstants.selectedModelOllama : AIConstants.selectedModelOpenAI;
              Get.find<LocalStorage>().set(key, models.first);
            }
            Get.snackbar('拉取模型', '成功获取 ${models.length} 个模型');
          } catch (e) {
            Get.snackbar('拉取失败', '模型列表拉取失败：$e');
          }
        },
      ),
      SettingItem(
        id: 'test_connection',
        title: '连接测试',
        description: '检测当前提供商配置是否可正常访问',
        icon: Icons.plagiarism_outlined,
        type: SettingItemType.button,
        onTap: () async {
          final storage = Get.find<LocalStorage>();
          final provider = storage.get<String>(AIConstants.providerType) ?? 'OpenAI';
          final service = AIServiceFactory.fromName(provider);
          try {
            Get.snackbar('连接测试', '开始测试 $provider 连接...');
            final ok = await service.testConnection();
            if (ok) {
              Get.snackbar('连接测试', '$provider 连接正常');
            } else {
              Get.snackbar('连接测试', '$provider 连接失败');
            }
          } catch (e) {
            Get.snackbar('连接失败', '连接测试异常：$e');
          }
        },
      ),
      SettingItem(
        id: 'temperature',
        title: '温度参数',
        description: '设置AI回复的随机性（0-1）',
        icon: Icons.thermostat,
        type: SettingItemType.textInput,
        value: AIConstants.defaultTemperature.toString(),
        placeholder: '请输入温度参数',
        onChanged: (value) {
          final storage = Get.find<LocalStorage>();
          final v = (value is String) ? value : (value?.toString() ?? AIConstants.defaultTemperature.toString());
          storage.set(AIConstants.temperature, v);
        },
      ),
      const SettingItem(
        id: 'divider_1',
        title: '',
        type: SettingItemType.divider,
      ),
      SettingItem(
        id: 'enable_streaming',
        title: '启用流式响应',
        description: '启用AI回复的流式显示',
        icon: Icons.stream,
        type: SettingItemType.toggle,
        value: true,
        onChanged: (value) {
          final storage = Get.find<LocalStorage>();
          storage.set(AIConstants.enableStreaming, value == true);
        },
      ),
    ];
  }
  
  /// 注册AI Provider设置到全局设置管理器
  static void registerToGlobalSettings() {
    // 这个函数将在AI Chat模块注册时调用
    // 通过SettingController注册到全局设置中
  }
}