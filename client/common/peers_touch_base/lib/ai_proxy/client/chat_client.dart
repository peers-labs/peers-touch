import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';

/// 聊天客户端接口
/// 使用ChatCompletionRequest和ChatCompletionResponse，与OpenAI API保持一致
abstract class ChatClient {
  /// 发送聊天消息
  Stream<ChatCompletionResponse> chat(ChatCompletionRequest request);
}