import 'dart:io';
import '../lib/src/utils/config_loader.dart';
import '../lib/src/managers/ai_provider_manager.dart';
import '../lib/src/models/chat_models.dart';
import '../lib/src/models/provider_config.dart';

void main() async {
  print('=== AI Provider 配置测试 ===\n');

  try {
    // 1. 加载配置文件
    print('1. 加载配置文件...');
    final configPath = 'example/ai_provider_debug.yml';
    final configMap = ConfigLoader.loadFromYaml(configPath);
    
    print('✅ 配置文件加载成功');
    print('配置内容:');
    print(configMap);
    print('');

    // 2. 解析配置
    print('2. 解析配置...');
    final providers = ConfigLoader.parseProviderConfigs(configMap);
    
    if (providers.isEmpty) {
      print('❌ 未找到有效的提供商配置');
      return;
    }
    
    print('✅ 解析成功，找到 ${providers.length} 个提供商');
    for (final provider in providers) {
      print('   - ${provider.name} (${provider.type.name})');
      print('     基础URL: ${provider.baseUrl}');
      print('     API Key: ${provider.apiKey != null ? '已配置' : '未配置'}');
    }
    print('');

    // 3. 创建提供商管理器
    print('3. 创建提供商管理器...');
    final manager = AIProviderManager();
    
    // 注册所有提供商
    for (final provider in providers) {
      switch (provider.type) {
        case AIProviderType.openai:
          manager.registerOpenAIProvider(
            id: provider.id,
            name: provider.name,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            headers: provider.headers,
            parameters: provider.parameters,
            enabled: provider.enabled,
            timeout: provider.timeout,
            maxRetries: provider.maxRetries,
          );
          break;
        case AIProviderType.ollama:
          manager.registerOllamaProvider(
            id: provider.id,
            name: provider.name,
            baseUrl: provider.baseUrl,
            headers: provider.headers,
            parameters: provider.parameters,
            enabled: provider.enabled,
            timeout: provider.timeout,
            maxRetries: provider.maxRetries,
          );
          break;
        default:
          print('⚠️  不支持的提供商类型: ${provider.type}');
      }
    }
    
    print('✅ 提供商管理器创建成功');
    print('已注册提供商: ${manager.providers.keys.join(', ')}');
    print('');

    // 4. 测试连接
    print('4. 测试提供商连接...');
    final connectionResults = await manager.checkAllConnections();
    
    for (final entry in connectionResults.entries) {
      final provider = manager.getProvider(entry.key);
      if (provider != null) {
        final status = entry.value ? '✅ 连接成功' : '❌ 连接失败';
        print('   - ${provider.config.name}: $status');
        
        if (entry.value) {
          // 如果连接成功，尝试获取模型列表
          try {
            final models = await provider.listModels();
            print('     可用模型: ${models.length} 个');
            for (final model in models.take(3)) { // 只显示前3个模型
              print('        - ${model.name}');
            }
            if (models.length > 3) {
              print('        - ... 还有 ${models.length - 3} 个模型');
            }
          } catch (e) {
            print('     获取模型列表失败: $e');
          }
        }
      }
    }
    print('');

    // 5. 测试聊天功能（如果至少有一个提供商连接成功）
    final connectedProviders = connectionResults.entries
        .where((entry) => entry.value)
        .map((entry) => entry.key)
        .toList();
    
    if (connectedProviders.isNotEmpty) {
      print('5. 测试聊天功能...');
      
      for (final providerId in connectedProviders.take(1)) { // 只测试第一个连接成功的提供商
        final provider = manager.getProvider(providerId);
        if (provider != null) {
          print('   使用提供商: ${provider.config.name}');
          
          try {
            // 创建测试请求
            final request = ChatCompletionRequest(
              model: 'gpt-3.5-turbo', // 使用通用模型名
              messages: [
                ChatMessage(
                  role: ChatRole.user,
                  content: '你好，请简单介绍一下你自己',
                ),
              ],
              temperature: 0.7,
              maxTokens: 100,
            );
            
            print('   发送测试消息...');
            final response = await manager.chatCompletionWithProvider(providerId, request);
            
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
      }
    } else {
      print('5. 跳过聊天测试 - 没有可用的提供商');
    }
    
    print('');

    // 6. 清理资源
    print('6. 清理资源...');
    await manager.closeAll();
    print('✅ 资源清理完成');

    print('\n=== 测试完成 ===');
    
  } catch (e) {
    print('❌ 测试过程中出现错误:');
    print(e);
    print('\n=== 测试失败 ===');
    exitCode = 1;
  }
}