import 'dart:io';
import 'package:peers_touch_ai_proxy_client/peers_touch_ai_proxy_client.dart';

void main() async {
  print('=== Ollama 本地客户端实验 ===\n');

  final manager = AIProviderManager();
  manager.registerOllamaProvider(
    id: 'local_ollama',
    name: 'Local Ollama',
    baseUrl: 'http://localhost:11434',
    timeout: 30000,
    maxRetries: 3,
  );

  final provider = manager.getProvider('local_ollama');
  if (provider == null) {
    print('❌ 提供商注册失败');
    exitCode = 1;
    return;
  }

  print('1. 检查连接...');
  final connected = await provider.checkConnection();
  print(connected ? '✅ 连接成功' : '❌ 连接失败');

  if (!connected) {
    await manager.closeAll();
    return;
  }

  print('\n2. 获取模型列表...');
  List<ModelInfo> models = [];
  try {
    models = await provider.listModels();
    if (models.isEmpty) {
      print('⚠️ 未发现本地模型，请先在 Ollama 中拉取或启动模型');
    } else {
      print('✅ 发现 ${models.length} 个模型');
      for (final m in models.take(5)) {
        print('   - ${m.name}');
      }
    }
  } catch (e) {
    print('❌ 获取模型失败: $e');
  }

  var modelName = 'llama2';
  if (models.isNotEmpty) {
    modelName = models.first.name;
  }

  print('\n3. 发送聊天请求 (模型: $modelName)...');
  final request = ChatCompletionRequest(
    model: modelName,
    messages: [
      ChatMessage(role: ChatRole.system, content: '你是一个简洁有用的助手。'),
      ChatMessage(role: ChatRole.user, content: '用一句话介绍一下你自己。'),
    ],
    temperature: 0.7,
    maxTokens: 200,
  );

  try {
    final resp = await provider.chatCompletion(request);
    if (resp.choices.isNotEmpty) {
      final msg = resp.choices.first.message.content;
      print('✅ 收到回复:');
      print('   "$msg"');
    } else {
      print('⚠️ 收到空回复');
    }
  } catch (e) {
    print('❌ 聊天失败: $e');
  }

  print('\n4. 清理资源...');
  await manager.closeAll();
  print('✅ 完成\n');
}