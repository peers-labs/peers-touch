import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';

abstract class IAiBoxService {
  Stream<ChatCompletionResponse> chat(ChatCompletionRequest request);
  
  /// 非流式聊天接口
  Future<ChatCompletionResponse> chatSync(ChatCompletionRequest request);
  
  /// 获取提供商的模型列表
  Future<List<String>> getModels(String providerId);
}