import 'package:flutter/material.dart';
import 'package:get/get.dart';
import '../../../core/constants/ai_constants.dart';
import '../../../core/storage/local_storage.dart';
import '../settings/model/setting_item.dart';

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
        id: 'openai_api_key',
        title: 'OpenAI API密钥',
        description: '设置OpenAI API访问密钥',
        icon: Icons.key,
        type: SettingItemType.textInput,
        value: _getStoredValue(AIConstants.openaiApiKey) ?? '',
        placeholder: '请输入OpenAI API密钥',
        onChanged: (value) {
          // 保存OpenAI API密钥
          _saveSetting(AIConstants.openaiApiKey, value);
        },
      ),
      SettingItem(
        id: 'openai_base_url',
        title: 'OpenAI基础URL',
        description: '设置OpenAI API基础URL（可选）',
        icon: Icons.link,
        type: SettingItemType.textInput,
        value: _getStoredValue(AIConstants.openaiBaseUrl) ?? AIConstants.defaultOpenAIBaseUrl,
        placeholder: '请输入OpenAI基础URL',
        onChanged: (value) {
          // 保存OpenAI基础URL
          _saveSetting(AIConstants.openaiBaseUrl, value);
        },
      ),
      SettingItem(
        id: 'model_selection',
        title: '默认模型',
        description: '选择默认使用的AI模型',
        icon: Icons.smart_toy,
        type: SettingItemType.select,
        value: _getStoredValue(AIConstants.selectedModel) ?? AIConstants.defaultOpenAIModel,
        options: AIConstants.supportedModels,
        onChanged: (value) {
          // 保存模型选择
          _saveSetting(AIConstants.selectedModel, value);
        },
      ),
      SettingItem(
        id: 'temperature',
        title: '温度参数',
        description: '设置AI回复的随机性（0-1）',
        icon: Icons.thermostat,
        type: SettingItemType.textInput,
        value: _getStoredValue(AIConstants.temperature) ?? AIConstants.defaultTemperature.toString(),
        placeholder: '请输入温度参数',
        onChanged: (value) {
          // 保存温度参数
          _saveSetting(AIConstants.temperature, value);
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
        value: _getStoredValue(AIConstants.enableStreaming) ?? true,
        onChanged: (value) {
          // 保存流式响应设置
          _saveSetting(AIConstants.enableStreaming, value.toString());
        },
      ),
    ];
  }
  
  /// 注册AI Provider设置到全局设置管理器
  static void registerToGlobalSettings() {
    // 这个函数将在AI Chat模块注册时调用
    // 通过SettingController注册到全局设置中
  }
  
  /// 获取存储的设置值
  static dynamic _getStoredValue(String key) {
    try {
      final storage = Get.find<LocalStorage>();
      return storage.get<String>(key);
    } catch (e) {
      return null;
    }
  }
  
  /// 保存设置到存储
  static void _saveSetting(String key, dynamic value) {
    try {
      final storage = Get.find<LocalStorage>();
      storage.set(key, value);
    } catch (e) {
      // 存储服务可能还未初始化
      print('保存设置失败: $key = $value, 错误: $e');
    }
  }
}