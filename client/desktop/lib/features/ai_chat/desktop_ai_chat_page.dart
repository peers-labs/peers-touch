import 'package:flutter/material.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_base/storage/service/ai_provider.dart';
import 'package:peers_touch_base/storage/secure_storage.dart';
import 'package:peers_touch_base/ai_proxy/ai_chat_proxy.dart';
import 'package:peers_touch_base/ai_proxy/ai_provider_proxy.dart';
import 'package:peers_touch_base/ai_proxy/models/provider.dart' as proxy_provider;
import 'package:peers_touch_base/ai_proxy/models/provider_config.dart';
import 'package:peers_touch_base/ai_proxy/providers/openai_client.dart';
import 'package:peers_touch_base/ai_proxy/providers/ollama_client.dart';
import 'package:peers_touch_base/ai_proxy/providers/deepseek_client.dart';
import 'package:peers_touch_base/ai_proxy/interfaces/ai_provider_interface.dart';
import 'package:peers_touch_base/ai_proxy/interfaces/ai_service.dart';
import 'package:peers_touch_base/ai_proxy/interfaces/ai_service_adapter.dart';

/// 桌面端AI聊天页面 - 仅包含视图逻辑
/// 所有业务逻辑都通过AIChatProxy处理
class DesktopAIChatPage extends StatefulWidget {
  const DesktopAIChatPage({super.key});

  @override
  State<DesktopAIChatPage> createState() => _DesktopAIChatPageState();
}

class _DesktopAIChatPageState extends State<DesktopAIChatPage> {
  late AIChatProxy _chatProxy;
  late AIProviderProxy _providerProxy;
  late TextEditingController _inputController;
  
  @override
  void initState() {
    super.initState();
    _initializeProxies();
    _inputController = TextEditingController();
  }
  
  /// 将Provider转换为ProviderConfig
  ProviderConfig _convertToProviderConfig(proxy_provider.Provider provider, String apiKey) {
    return ProviderConfig(
      id: provider.id,
      type: _parseProviderType(provider.sourceType),
      name: provider.name,
      baseUrl: provider.config?['baseUrl'] ?? '',
      apiKey: apiKey,
      headers: provider.config?['headers'] != null 
          ? Map<String, dynamic>.from(provider.config!['headers'])
          : null,
      parameters: provider.config?['parameters'] != null
          ? Map<String, dynamic>.from(provider.config!['parameters'])
          : null,
      enabled: provider.enabled,
      timeout: provider.config?['timeout'] ?? 30000,
      maxRetries: provider.config?['maxRetries'] ?? 3,
    );
  }
  
  /// 解析提供商类型
  AIProviderType _parseProviderType(String sourceType) {
    switch (sourceType.toLowerCase()) {
      case 'openai':
        return AIProviderType.openai;
      case 'ollama':
        return AIProviderType.ollama;
      case 'deepseek':
        return AIProviderType.deepseek;
      case 'claude':
        return AIProviderType.claude;
      case 'gemini':
        return AIProviderType.gemini;
      default:
        return AIProviderType.openai;
    }
  }
  
  /// 创建AI服务实例
  AIService? _createAIService(proxy_provider.Provider provider, String apiKey) {
    final config = _convertToProviderConfig(provider, apiKey);
    AIProvider? aiProvider;
    
    switch (config.type) {
      case AIProviderType.openai:
        aiProvider = OpenAIClient(config);
        break;
      case AIProviderType.ollama:
        aiProvider = OllamaClient(config);
        break;
      case AIProviderType.deepseek:
        aiProvider = DeepSeekClient(config);
        break;
      // 可以添加其他提供商类型
      default:
        return null;
    }
    
    return AIServiceAdapter(aiProvider);
  }
  
  void _initializeProxies() {
    final storage = LocalStorage();
    final providerStorage = AIProviderStorageServiceImpl(localStorage: storage);
    final secureStorage = BasicSecureStorageService();
    
    _chatProxy = AIChatProxy(
      storage: storage,
    );
    
    _providerProxy = AIProviderProxy(
      providerService: providerStorage,
      secureStorage: secureStorage,
    );
    
    // 监听代理状态变化
    _chatProxy.messages.addListener(_onMessagesChanged);
    _chatProxy.isSending.addListener(_onSendingChanged);
    _chatProxy.error.addListener(_onErrorChanged);
  }
  
  void _onMessagesChanged() {
    if (mounted) {
      setState(() {});
    }
  }
  
  void _onSendingChanged() {
    if (mounted) {
      setState(() {});
    }
  }
  
  void _onErrorChanged() {
    if (mounted && _chatProxy.error.value != null) {
      final errorMessage = _chatProxy.error.value!;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(errorMessage)),
          );
        }
      });
    }
  }
  
  @override
  void dispose() {
    _inputController.dispose();
    _chatProxy.messages.removeListener(_onMessagesChanged);
    _chatProxy.isSending.removeListener(_onSendingChanged);
    _chatProxy.error.removeListener(_onErrorChanged);
    _chatProxy.dispose();
    _providerProxy.dispose();
    super.dispose();
  }
  
  Future<void> _sendMessage() async {
    final text = _inputController.text.trim();
    if (text.isEmpty) return;
    
    // 获取当前AI服务
    final currentProvider = _providerProxy.currentProvider.value;
    if (currentProvider == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('请先配置AI提供商')),
        );
      }
      return;
    }
    
    // 获取API密钥
    final apiKey = await _providerProxy.getApiKey(currentProvider.id);
    if (apiKey == null || apiKey.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('API密钥未配置')),
        );
      }
      return;
    }
    
    // 创建AI服务实例
    final aiService = _createAIService(currentProvider, apiKey);
    if (aiService == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('不支持的AI提供商类型')),
        );
      }
      return;
    }
    
    // 发送消息
    await _chatProxy.sendMessage(
      text: text,
      aiService: aiService,
      model: _chatProxy.currentModel.value,
    );
    
    _inputController.clear();
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI聊天'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () {
              // 打开设置页面
              Navigator.pushNamed(context, '/ai_settings');
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // 会话列表
          SizedBox(
            height: 60,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: _chatProxy.sessions.value.length,
              itemBuilder: (context, index) {
                final session = _chatProxy.sessions.value[index];
                final isSelected = session.id == _chatProxy.selectedSessionId.value;
                return Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: ChoiceChip(
                    label: Text(session.title),
                    selected: isSelected,
                    onSelected: (selected) async {
                      if (selected) {
                        await _chatProxy.selectSession(session.id);
                      }
                    },
                  ),
                );
              },
            ),
          ),
          
          // 消息列表
          Expanded(
            child: ListView.builder(
              itemCount: _chatProxy.messages.value.length,
              itemBuilder: (context, index) {
                final message = _chatProxy.messages.value[index];
                final isUser = message.role == 'user';
                
                return Align(
                  alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: isUser ? Theme.of(context).primaryColor : Colors.grey[200],
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      message.content,
                      style: TextStyle(
                        color: isUser ? Colors.white : Colors.black,
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          
          // 输入区域
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.grey.withValues(alpha: 0.2),
                  blurRadius: 4,
                  offset: const Offset(0, -2),
                ),
              ],
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _inputController,
                    decoration: const InputDecoration(
                      hintText: '输入消息...',
                      border: OutlineInputBorder(),
                    ),
                    maxLines: null,
                    onSubmitted: (_) => _sendMessage(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: _chatProxy.isSending.value
                      ? const CircularProgressIndicator()
                      : const Icon(Icons.send),
                  onPressed: _chatProxy.isSending.value ? null : _sendMessage,
                ),
              ],
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () async => await _chatProxy.newChat(),
        tooltip: '新建会话',
        child: const Icon(Icons.add),
      ),
    );
  }
}