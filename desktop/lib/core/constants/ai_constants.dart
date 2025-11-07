/// AI相关常量配置
class AIConstants {
  // OpenAI配置
  static const String defaultOpenAIBaseUrl = 'https://api.openai.com';
  static const String defaultOpenAIModel = 'gpt-3.5-turbo';
  static const double defaultTemperature = 0.7;
  static const int defaultMaxTokens = 2000;
  
  // 支持的模型列表
  static const List<String> supportedModels = [
    'gpt-4',
    'gpt-4-turbo-preview',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k',
  ];
  
  // 存储键
  static const String openaiApiKey = 'openai_api_key';
  static const String openaiBaseUrl = 'openai_base_url';
  static const String selectedModel = 'ai_selected_model';
  static const String temperature = 'ai_temperature';
  static const String enableStreaming = 'ai_enable_streaming';
}