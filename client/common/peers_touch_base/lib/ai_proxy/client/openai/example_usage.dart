/// OpenAI Chat Client 使用示例
/// 
/// 展示OpenAiChatClient在不同场景下的使用方法

import 'dart:async';
import 'package:fixnum/fixnum.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';

import 'openai.dart';

class OpenAiChatClientExample {
  /// 基础聊天示例
  static Future<void> basicChatExample() async {
    print('=== 基础聊天示例 ===');
    
    // 创建客户端
    final client = OpenAiClientFactory.createChatClient(
      apiKey: 'your-openai-api-key',
    );
    
    try {
      // 创建用户消息
      final userMessage = ChatMessage()
        ..id = 'msg_${DateTime.now().millisecondsSinceEpoch}'
        ..sessionId = 'session_example'
        ..role = ChatRole.CHAT_ROLE_USER
        ..content = '你好，请用中文回答：什么是人工智能？'
        ..modelName = 'gpt-3.5-turbo'
        ..createdAt = Int64(DateTime.now().millisecondsSinceEpoch)
        ..updatedAt = Int64(DateTime.now().millisecondsSinceEpoch);
      
      print('发送消息: ${userMessage.content}');
      
      // 发送消息并处理流式响应
      final stream = client.chat(userMessage);
      
      await for (final response in stream) {
        if (response.hasErrorJson()) {
          print('发生错误: ${response.errorJson}');
          break;
        }
        
        if (response.content.isNotEmpty) {
          print('AI回复: ${response.content}');
        }
      }
      
    } finally {
      // 关闭客户端
      client.close();
    }
  }
  
  /// 多轮对话示例
  static Future<void> multiTurnChatExample() async {
    print('\\n=== 多轮对话示例 ===');
    
    final client = OpenAiClientFactory.createChatClient(
      apiKey: 'your-openai-api-key',
    );
    
    try {
      // 第一轮对话
      final firstMessage = ChatMessage()
        ..id = 'msg_1'
        ..sessionId = 'session_multi_turn'
        ..role = ChatRole.CHAT_ROLE_USER
        ..content = '我想学习编程，有什么建议吗？'
        ..modelName = 'gpt-3.5-turbo'
        ..createdAt = Int64(DateTime.now().millisecondsSinceEpoch)
        ..updatedAt = Int64(DateTime.now().millisecondsSinceEpoch);
      
      print('第一轮 - 用户: ${firstMessage.content}');
      
      final firstResponse = await client.chat(firstMessage).first;
      print('第一轮 - AI: ${firstResponse.content}');
      
      // 第二轮对话（基于第一轮回复）
      final secondMessage = ChatMessage()
        ..id = 'msg_2'
        ..sessionId = 'session_multi_turn'
        ..role = ChatRole.CHAT_ROLE_USER
        ..content = 'Python和JavaScript哪个更适合初学者？'
        ..modelName = 'gpt-3.5-turbo'
        ..createdAt = Int64(DateTime.now().millisecondsSinceEpoch)
        ..updatedAt = Int64(DateTime.now().millisecondsSinceEpoch);
      
      print('\\n第二轮 - 用户: ${secondMessage.content}');
      
      final secondResponse = await client.chat(secondMessage).first;
      print('第二轮 - AI: ${secondResponse.content}');
      
    } finally {
      client.close();
    }
  }
  
  /// 错误处理示例
  static Future<void> errorHandlingExample() async {
    print('\\n=== 错误处理示例 ===');
    
    // 使用无效的API密钥测试错误处理
    final client = OpenAiClientFactory.createChatClient(
      apiKey: 'invalid-api-key',
    );
    
    try {
      final testMessage = ChatMessage()
        ..id = 'msg_error_test'
        ..sessionId = 'session_error_test'
        ..role = ChatRole.CHAT_ROLE_USER
        ..content = '测试消息'
        ..modelName = 'gpt-3.5-turbo'
        ..createdAt = Int64(DateTime.now().millisecondsSinceEpoch)
        ..updatedAt = Int64(DateTime.now().millisecondsSinceEpoch);
      
      final stream = client.chat(testMessage);
      
      await for (final response in stream) {
        if (response.hasErrorJson()) {
          print('错误处理成功: ${response.errorJson}');
          break;
        }
      }
      
    } finally {
      client.close();
    }
  }
  
  /// 自定义配置示例
  static Future<void> customConfigExample() async {
    print('\\n=== 自定义配置示例 ===');
    
    // 使用自定义配置创建客户端
    final client = OpenAiClientFactory.createChatClientWithConfig(
      apiKey: 'your-openai-api-key',
      baseUrl: 'https://api.openai.com/v1',
      timeout: 30, // 30秒超时
      maxRetries: 3, // 最多重试3次
    );
    
    try {
      final message = ChatMessage()
        ..id = 'msg_custom_config'
        ..sessionId = 'session_custom_config'
        ..role = ChatRole.CHAT_ROLE_USER
        ..content = '测试自定义配置'
        ..modelName = 'gpt-3.5-turbo'
        ..createdAt = Int64(DateTime.now().millisecondsSinceEpoch)
        ..updatedAt = Int64(DateTime.now().millisecondsSinceEpoch);
      
      print('使用自定义配置发送消息...');
      
      final stream = client.chat(message);
      
      await for (final response in stream) {
        if (response.hasErrorJson()) {
          print('错误: ${response.errorJson}');
          break;
        }
        
        if (response.content.isNotEmpty) {
          print('响应: ${response.content}');
        }
      }
      
    } finally {
      client.close();
    }
  }
  
  /// 运行所有示例
  static Future<void> runAllExamples() async {
    print('开始运行OpenAI Chat Client示例...\\n');
    
    // 注释掉需要真实API密钥的示例
    // await basicChatExample();
    // await multiTurnChatExample();
    // await customConfigExample();
    
    // 运行错误处理示例（不需要真实API密钥）
    await errorHandlingExample();
    
    print('\\n示例运行完成！');
    print('注意：需要替换为真实的OpenAI API密钥才能运行完整示例。');
  }
}

void main() async {
  await OpenAiChatClientExample.runAllExamples();
}