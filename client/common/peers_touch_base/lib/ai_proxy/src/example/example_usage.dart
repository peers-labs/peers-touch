import 'dart:io';
import 'package:peers_touch_ai_proxy_client/peers_touch_ai_proxy_client.dart';

/// 示例：如何使用 AI 代理客户端（基于配置文件）
void main() async {
  print('=== AI Provider 配置示例 ===\n');

  try {
    // 1. 从配置文件加载提供商配置
    print('1. 加载配置文件...');
    final configPath = 'example/ai_provider_debug.yml';
    final configMap = ConfigLoader.loadFromYaml(configPath);
    
    print('✅ 配置文件加载成功');
    print('配置文件路径: $configPath');
    print('');

    // 2. 解析配置
    print('2. 解析配置...');
    final providers = ConfigLoader.parseProviderConfigs(configMap);
    
    if (providers.isEmpty) {
      print('❌ 未找到有效的提供商配置');
      print('请检查配置文件格式是否正确');
      return;
    }
    
    print('✅ 解析成功，找到 ${providers.length} 个提供商');
    for (final provider in providers) {
      print('   - ${provider.name} (${provider.type.name})');
      print('     基础URL: ${provider.baseUrl}');
      print('     API Key: ${provider.apiKey != null ? '已配置' : '未配置'}');
      print('     超时时间: ${provider.timeout}ms');
    }
    print('');

    // 3. 创建 AI Provider 管理器
    print('3. 创建 AI Provider 管理器...');
    final providerManager = AIProviderManager();
    
    // 4. 根据配置注册提供商
    print('4. 注册提供商...');
    for (final providerConfig in providers) {
      switch (providerConfig.type) {
        case AIProviderType.openai:
          providerManager.registerOpenAIProvider(
            id: providerConfig.id,
            name: providerConfig.name,
            baseUrl: providerConfig.baseUrl,
            apiKey: providerConfig.apiKey,
            headers: providerConfig.headers,
            parameters: providerConfig.parameters,
            enabled: providerConfig.enabled,
            timeout: providerConfig.timeout,
            maxRetries: providerConfig.maxRetries,
          );
          print('   ✅ 注册 OpenAI 提供商: ${providerConfig.name}');
          break;
        case AIProviderType.ollama:
          providerManager.registerOllamaProvider(
            id: providerConfig.id,
            name: providerConfig.name,
            baseUrl: providerConfig.baseUrl,
            headers: providerConfig.headers,
            parameters: providerConfig.parameters,
            enabled: providerConfig.enabled,
            timeout: providerConfig.timeout,
            maxRetries: providerConfig.maxRetries,
          );
          print('   ✅ 注册 Ollama 提供商: ${providerConfig.name}');
          break;
        default:
          print('   ⚠️  不支持的提供商类型: ${providerConfig.type}');
      }
    }
    print('');

    // 5. 设置默认提供商（使用第一个可用的提供商）
    if (providers.isNotEmpty) {
      final defaultProvider = providers.first;
      providerManager.setDefaultProvider(defaultProvider.id);
      print('5. 设置默认提供商: ${defaultProvider.name}');
      print('');
    }

    // 6. 检查所有提供商连接状态
    print('6. 检查提供商连接状态...');
    final connectionResults = await providerManager.checkAllConnections();
    
    var connectedCount = 0;
    for (final entry in connectionResults.entries) {
      final provider = providerManager.getProvider(entry.key);
      if (provider != null) {
        final status = entry.value ? '✅ 连接成功' : '❌ 连接失败';
        print('   - ${provider.config.name}: $status');
        if (entry.value) connectedCount++;
      }
    }
    
    if (connectedCount == 0) {
      print('\n⚠️  没有可用的提供商连接，跳过后续测试');
      await providerManager.closeAll();
      return;
    }
    print('');

    // 7. 获取可用模型列表
    print('7. 获取可用模型...');
    final models = await providerManager.getAllModels();
    
    for (final entry in models.entries) {
      final provider = providerManager.getProvider(entry.key);
      if (provider != null && entry.value.isNotEmpty) {
        print('   ${provider.config.name} 有 ${entry.value.length} 个模型:');
        for (final model in entry.value.take(3)) { // 只显示前3个
          print('     - ${model.name}');
        }
        if (entry.value.length > 3) {
          print('     - ... 还有 ${entry.value.length - 3} 个模型');
        }
      }
    }
    print('');

    // 8. 使用默认提供商进行聊天测试
    print('8. 聊天功能测试...');
    
    // 获取第一个连接成功的提供商
    final connectedProviderId = connectionResults.entries
        .firstWhere((entry) => entry.value, orElse: () => connectionResults.entries.first)
        .key;
    
    final connectedProvider = providerManager.getProvider(connectedProviderId);
    if (connectedProvider != null) {
      print('   使用提供商: ${connectedProvider.config.name}');
      
      try {
        // 根据提供商类型选择合适的模型
        String modelName;
        switch (connectedProvider.config.type) {
          case AIProviderType.openai:
            modelName = 'gpt-3.5-turbo'; // OpenAI 通用模型
            break;
          case AIProviderType.ollama:
            modelName = 'llama2'; // Ollama 默认模型
            break;
          default:
            modelName = 'default-model';
        }
        
        final request = ChatCompletionRequest(
          model: modelName,
          messages: [
            ChatMessage(
              role: ChatRole.system,
              content: '你是一个有用的助手，请用简洁的语言回答。',
            ),
            ChatMessage(
              role: ChatRole.user,
              content: '你好！请简单介绍一下你自己。',
            ),
          ],
          temperature: 0.7,
          maxTokens: 200,
        );
        
        print('   发送测试消息...');
        final response = await providerManager.chatCompletionWithProvider(
          connectedProviderId, 
          request
        );
        
        if (response.choices.isNotEmpty) {
          final message = response.choices.first.message;
          print('   ✅ 收到回复:');
          print('   "${message.content}"');
          print('   使用模型: ${response.model}');
          if (response.usage != null) {
            print('   使用统计: ${response.usage!.promptTokens} + ${response.usage!.completionTokens} = ${response.usage!.totalTokens} tokens');
          }
        } else {
          print('   ⚠️  收到空回复');
        }
      } catch (e) {
        print('   ❌ 聊天测试失败: $e');
      }
    }
    print('');

    // 9. 演示智能提供商选择
    print('9. 智能提供商选择演示...');
    final smartAssistant = SmartAIAssistant(providerManager);
    
    try {
      final result = await smartAssistant.smartChat('什么是人工智能？');
      print('   ✅ 智能回复:');
      print('   "${result.substring(0, min(result.length, 100))}..."');
    } catch (e) {
      print('   ❌ 智能聊天失败: $e');
    }
    print('');

    // 10. 清理资源
    print('10. 清理资源...');
    await providerManager.closeAll();
    print('✅ 资源清理完成');

    print('\n=== 示例运行完成 ===');
    print('\n配置说明:');
    print('- 配置文件路径: example/ai_provider_debug.yml');
    print('- 支持动态加载多个提供商配置');
    print('- 自动检测连接状态并选择可用提供商');
    print('- 支持智能回退机制');
    
  } catch (e) {
    print('❌ 示例运行过程中出现错误:');
    print(e);
    print('\n=== 示例运行失败 ===');
    exitCode = 1;
  }
}

/// 辅助函数：获取最小值
int min(int a, int b) => a < b ? a : b;

/// 高级用法示例：智能提供商选择
class SmartAIAssistant {
  final AIProviderManager _providerManager;

  SmartAIAssistant(this._providerManager);

  /// 智能选择提供商并聊天
  Future<String> smartChat(String message) async {
    try {
      // 尝试选择最优提供商
      final optimalProvider = await _providerManager.selectOptimalProvider(
        model: 'gpt-3.5-turbo',
        maxTokens: 300,
      );

      final providerId = optimalProvider ?? _providerManager.providers.keys.first;
      final provider = _providerManager.getProvider(providerId);
      
      print('   智能选择提供商: ${provider?.config.name ?? providerId}');
      
      // 根据提供商类型选择合适的模型
      String modelName;
      if (provider != null) {
        switch (provider.config.type) {
          case AIProviderType.openai:
            modelName = 'gpt-3.5-turbo';
            break;
          case AIProviderType.ollama:
            modelName = 'llama2';
            break;
          default:
            modelName = 'default-model';
        }
      } else {
        modelName = 'gpt-3.5-turbo';
      }
      
      final request = ChatCompletionRequest(
        model: modelName,
        messages: [
          ChatMessage(
            role: ChatRole.system,
            content: '请用简洁的语言回答用户的问题。',
          ),
          ChatMessage(role: ChatRole.user, content: message),
        ],
        temperature: 0.7,
        maxTokens: 300,
      );

      final response = await _providerManager.chatCompletionWithProvider(
        providerId,
        request,
      );

      return response.choices.first.message.content;
    } catch (e) {
      // 如果失败，尝试备用提供商
      print('   主提供商失败，尝试备用方案...');
      return _fallbackChat(message);
    }
  }

  /// 备用聊天方法
  Future<String> _fallbackChat(String message) async {
    // 尝试所有可用的提供商
    for (final providerId in _providerManager.enabledProviders.keys) {
      try {
        final provider = _providerManager.getProvider(providerId);
        if (provider == null) continue;
        
        print('   尝试备用提供商: ${provider.config.name}');
        
        // 根据提供商类型选择合适的模型
        String modelName;
        switch (provider.config.type) {
          case AIProviderType.openai:
            modelName = 'gpt-3.5-turbo';
            break;
          case AIProviderType.ollama:
            modelName = 'llama2';
            break;
          default:
            modelName = 'default-model';
        }
        
        final request = ChatCompletionRequest(
          model: modelName,
          messages: [
            ChatMessage(role: ChatRole.user, content: message),
          ],
          temperature: 0.7,
          maxTokens: 200,
        );

        final response = await _providerManager.chatCompletionWithProvider(
          providerId,
          request,
        );

        return response.choices.first.message.content;
      } catch (e) {
        print('   提供商 $providerId 失败: $e');
        continue;
      }
    }

    throw Exception('所有提供商都失败了');
  }
}