import 'dart:convert';
import 'package:peers_touch_base/ai_proxy/provider/provider_manager_local.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_facade_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';

// 这是一个独立的集成测试脚本，用于验证 AiBoxFacadeService 是否能与真实运行的服务端点通信。
//
// 如何运行:
// 1. 确保你本地的 Ollama 服务正在 http://localhost:11434 运行。
// 2. 在终端中，导航到 `client/common/peers_touch_base` 目录。
// 3. 运行命令: `dart test/real_fetch_test.dart`
//
// 预期输出:
// 如果连接成功，它将打印从你的 Ollama 服务获取到的模型列表。
// 如果失败，它将打印错误信息。

void main() async {
  print('开始执行真实网络请求测试...');

  // 1. 创建一个本地提供商管理器
  // AiBoxFacadeService 默认使用 LocalProviderManager
  final providerManager = LocalProviderManager();

  // 2. 定义一个指向你本地 Ollama 服务的提供商
  final ollamaProvider = Provider(
    id: 'my-local-ollama',
    sourceType: 'ollama',
    name: 'Local Ollama',
    enabled: true,
    configJson: jsonEncode({
      'base_url': 'http://localhost:11434',
    }),
  );

  // 3. 将这个提供商添加到管理器中
  // 我们需要先清除，以防之前有同名提供商
  try {
    await providerManager.deleteProvider(ollamaProvider.id);
  } catch (_) {}
  await providerManager.createProvider(ollamaProvider);

  // 4. 创建 AiBoxFacadeService 实例
  // 注意：我们在这里传入了真实的 providerManager
  final service = AiBoxFacadeService.internal(providerManager);

  print('正在尝试从 ${ollamaProvider.configJson} 获取模型列表...');

  try {
    // 5. 调用服务方法，发起真实网络请求
    final models = await service.getProviderModels(ollamaProvider.id);

    // 6. 检查并打印结果
    if (models.isNotEmpty) {
      print('\n✅ 测试成功！获取到的模型列表:');
      for (var model in models) {
        print('  - $model');
      }
    } else {
      print('\n⚠️ 测试通过，但未获取到任何模型。请检查你的 Ollama 服务中是否已加载模型。');
    }
  } catch (e) {
    print('\n❌ 测试失败！发生错误:');
    print(e);
  } finally {
    // 清理测试数据
    await providerManager.deleteProvider(ollamaProvider.id);
    print('\n测试执行完毕。');
  }
}
