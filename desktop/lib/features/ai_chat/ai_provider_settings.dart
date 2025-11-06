import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';

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
        value: '',
        placeholder: '请输入OpenAI API密钥',
        onChanged: (value) {
          // 保存OpenAI API密钥
          // print('OpenAI API密钥更新: $value');
        },
      ),
      SettingItem(
        id: 'openai_base_url',
        title: 'OpenAI基础URL',
        description: '设置OpenAI API基础URL（可选）',
        icon: Icons.link,
        type: SettingItemType.textInput,
        value: 'https://api.openai.com',
        placeholder: '请输入OpenAI基础URL',
        onChanged: (value) {
          // 保存OpenAI基础URL
          // print('OpenAI基础URL更新: $value');
        },
      ),
      SettingItem(
        id: 'model_selection',
        title: '默认模型',
        description: '选择默认使用的AI模型',
        icon: Icons.smart_toy,
        type: SettingItemType.select,
        value: 'gpt-4',
        options: ['gpt-4', 'gpt-3.5-turbo', 'claude-3', 'gemini-pro'],
        onChanged: (value) {
          // 保存模型选择
          // print('默认模型更新: $value');
        },
      ),
      SettingItem(
        id: 'temperature',
        title: '温度参数',
        description: '设置AI回复的随机性（0-1）',
        icon: Icons.thermostat,
        type: SettingItemType.textInput,
        value: '0.7',
        placeholder: '请输入温度参数',
        onChanged: (value) {
          // 保存温度参数
          // print('温度参数更新: $value');
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
          // 保存流式响应设置
          // print('流式响应设置更新: $value');
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