/// AI相关常量配置
class AIConstants {
  // OpenAI配置
  static const String defaultOpenAIBaseUrl = 'https://api.openai.com';
  static const String defaultOpenAIModel = 'gpt-3.5-turbo';
  static const double defaultTemperature = 0.7;
  static const int defaultMaxTokens = 2000;
  static const String defaultSystemPrompt = 'You are a helpful assistant for Peers Touch Desktop.';
  
  // 预置模型列表（MVP移除实际使用，保留以兼容旧代码）
  static const List<String> supportedModels = [];
  
  // 存储键
  static const String openaiApiKey = 'openai_api_key';
  static const String openaiBaseUrl = 'openai_base_url';
  static const String selectedModel = 'ai_selected_model'; // 旧键（兼容）
  static const String selectedModelOpenAI = 'ai_selected_model_openai';
  static const String selectedModelOllama = 'ai_selected_model_ollama';
  static const String temperature = 'ai_temperature';
  static const String enableStreaming = 'ai_enable_streaming';
  static const String providerType = 'ai_provider_type';
  static const String systemPrompt = 'ai_system_prompt';

  // Ollama 配置
  static const String ollamaBaseUrl = 'ollama_base_url';
  static const String ollamaClientSideMode = 'ollama_client_side_mode';

  // AI Chat 持久化
  static const String chatSessions = 'ai_chat_sessions'; // List<Map>
  static const String chatSelectedSessionId = 'ai_chat_selected_session_id';
  static const String chatTopics = 'ai_chat_topics'; // List<String>
  static const String chatShowTopicPanel = 'ai_chat_show_topic_panel';
  static const String chatMessagesPrefix = 'ai_chat_messages_'; // + sessionId
}