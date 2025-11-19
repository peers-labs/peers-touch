import 'dart:async';
import 'dart:math';

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/http_service_impl.dart';

import '../chat_client.dart';
import 'openai_models.dart';

/// OpenAI聊天客户端实现
/// 支持OpenAI API调用，将ChatCompletionRequest转换为OpenAI格式并处理流式响应
class OpenAiChatClient implements ChatClient {
  final IHttpService _httpService;

  /// 创建OpenAI聊天客户端
  /// 
  /// [apiKey]: OpenAI API密钥（预留参数，用于未来扩展）
  /// [baseUrl]: OpenAI API基础URL，默认为官方API地址
  /// [httpService]: HTTP服务实例，可选
  OpenAiChatClient({
    required String apiKey,
    String baseUrl = 'https://api.openai.com/v1',
    IHttpService? httpService,
  }) : _httpService = httpService ?? HttpServiceImpl(baseUrl: baseUrl);

  /// 发送聊天消息并返回流式响应
  /// 
  /// 将ChatCompletionRequest转换为OpenAI请求格式，支持流式响应
  /// 自动处理消息角色转换和内容格式化
  @override
  Stream<ChatCompletionResponse> chat(ChatCompletionRequest request) async* {
    try {
      // 转换ChatCompletionRequest为OpenAI请求格式
      final openAiRequest = _convertToOpenAiRequest(request);
      
      // 由于当前Dio网络服务不支持流式响应，我们使用非流式响应
      // 后续可以扩展为支持真正的流式响应
      final response = await _httpService.post<Map<String, dynamic>>(
        '/chat/completions',
        data: openAiRequest.toJson(),
      );

      // 处理响应数据
      if (response.containsKey('choices') && response['choices'] is List) {
        final choices = response['choices'] as List;
        
        for (final choice in choices) {
          if (choice is Map<String, dynamic> && choice.containsKey('message')) {
            final message = choice['message'] as Map<String, dynamic>;
            if (message.containsKey('content')) {
              final content = message['content']?.toString() ?? '';
              
              // 创建ChatCompletionResponse
              final completionResponse = ChatCompletionResponse()
                ..id = response['id']?.toString() ?? _generateMessageId()
                ..object = response['object']?.toString() ?? 'chat.completion'
                ..created = response['created'] != null 
                    ? $fixnum.Int64(response['created'] as int) 
                    : _currentTimestamp()
                ..model = response['model']?.toString() ?? request.model
                ..choices.add(ChatChoice()
                  ..index = choice['index'] as int? ?? 0
                  ..message = ChatMessage()
                  ..finishReason = choice['finish_reason']?.toString() ?? '');
              
              completionResponse.choices[0].message
                ..role = ChatRole.CHAT_ROLE_ASSISTANT
                ..content = content;
              
              // 模拟流式响应：分批次返回内容
              final contentChunks = _splitContentIntoChunks(content, 10);
              for (final chunk in contentChunks) {
                final streamResponse = ChatCompletionResponse()
                  ..id = completionResponse.id
                  ..object = 'chat.completion.chunk'
                  ..created = completionResponse.created
                  ..model = completionResponse.model
                  ..choices.add(ChatChoice()
                    ..index = 0
                    ..message = ChatMessage()
                    ..finishReason = '');
                
                streamResponse.choices[0].message
                  ..role = ChatRole.CHAT_ROLE_ASSISTANT
                  ..content = chunk;
                
                yield streamResponse;
                // 添加延迟以模拟流式响应
                await Future.delayed(const Duration(milliseconds: 50));
              }
            }
          }
        }
      } else {
        throw Exception('Invalid response format from OpenAI API');
      }
    } catch (e) {
      // 返回错误消息作为ChatCompletionResponse
      final errorResponse = ChatCompletionResponse()
        ..id = _generateMessageId()
        ..object = 'chat.completion.error'
        ..created = _currentTimestamp()
        ..model = request.model
        ..choices.add(ChatChoice()
          ..index = 0
          ..message = ChatMessage()
          ..finishReason = 'error');
      
      errorResponse.choices[0].message
        ..role = ChatRole.CHAT_ROLE_ASSISTANT
        ..content = 'Error: $e';
      
      yield errorResponse;
    }
  }

  /// 将内容分割为多个块以模拟流式响应
  List<String> _splitContentIntoChunks(String content, int chunkSize) {
    final chunks = <String>[];
    for (int i = 0; i < content.length; i += chunkSize) {
      final end = i + chunkSize > content.length ? content.length : i + chunkSize;
      chunks.add(content.substring(i, end));
    }
    return chunks;
  }

  /// 转换ChatCompletionRequest为OpenAI请求格式
  OpenAiChatRequest _convertToOpenAiRequest(ChatCompletionRequest request) {
    // 直接使用ChatCompletionRequest中的消息列表和模型名称
    final messages = request.messages.map((msg) => OpenAiMessage(
      role: _convertRole(msg.role),
      content: msg.content,
    )).toList();

    return OpenAiChatRequest(
      model: request.model.isNotEmpty ? request.model : 'gpt-3.5-turbo',
      messages: messages,
      stream: true,
    );
  }

  /// 转换ChatRole为OpenAI角色字符串
  String _convertRole(ChatRole role) {
    switch (role) {
      case ChatRole.CHAT_ROLE_SYSTEM:
        return 'system';
      case ChatRole.CHAT_ROLE_USER:
        return 'user';
      case ChatRole.CHAT_ROLE_ASSISTANT:
        return 'assistant';
      case ChatRole.CHAT_ROLE_TOOL:
        return 'tool';
      default:
        return 'user';
    }
  }



  /// 生成消息ID
  String _generateMessageId() {
    return 'msg_${DateTime.now().millisecondsSinceEpoch}_${_randomString(8)}';
  }

  /// 生成随机字符串
  String _randomString(int length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    final random = Random();
    return String.fromCharCodes(
      Iterable.generate(
        length,
        (_) => chars.codeUnitAt(random.nextInt(chars.length)),
      ),
    );
  }

  /// 获取当前时间戳
  $fixnum.Int64 _currentTimestamp() {
    return $fixnum.Int64(DateTime.now().millisecondsSinceEpoch);
  }

  /// 关闭HTTP服务（预留方法）
  void close() {
    // Dio HTTP服务通常不需要手动关闭
    // 如果需要清理资源，可以在这里实现
  }
}