/// AI 提供商常量定义
class AIConstants {
  // OpenAI 默认配置
  static const String openaiDefaultBaseUrl = 'https://api.openai.com/v1';
  static const String openaiDefaultModel = 'gpt-3.5-turbo';
  
  // Ollama 默认配置
  static const String ollamaDefaultBaseUrl = 'http://localhost:11434';
  static const String ollamaDefaultModel = 'llama2';
  
  // 默认超时时间（毫秒）
  static const int defaultTimeout = 30000;
  static const int defaultMaxRetries = 3;
  
  // 重试延迟（毫秒）
  static const int retryDelay = 1000;
  
  // 支持的模型前缀
  static const List<String> openaiModelPrefixes = [
    'gpt-',
    'text-',
    'davinci-',
    'curie-',
    'babbage-',
    'ada-',
  ];
  
  static const List<String> ollamaModelPrefixes = [
    'llama',
    'mistral',
    'codellama',
    'phi',
    'gemma',
    'qwen',
    'deepseek',
  ];
  
  // API 端点
  static const String chatCompletionsEndpoint = '/v1/chat/completions';
  static const String modelsEndpoint = '/v1/models';
  static const String embeddingsEndpoint = '/v1/embeddings';
  
  // Ollama 原生端点
  static const String ollamaChatEndpoint = '/api/chat';
  static const String ollamaModelsEndpoint = '/api/tags';
  static const String ollamaGenerateEndpoint = '/api/generate';
  
  // 错误消息
  static const String connectionError = 'Failed to connect to AI provider';
  static const String authenticationError = 'Authentication failed - check your API key';
  static const String rateLimitError = 'Rate limit exceeded - please try again later';
  static const String quotaExceededError = 'Quota exceeded - please check your usage limits';
  static const String invalidRequestError = 'Invalid request - please check your parameters';
  static const String serverError = 'Server error - please try again later';
  static const String timeoutError = 'Request timeout - please try again';
  static const String unknownError = 'Unknown error occurred';
  
  // 配置键
  static const String configKeyBaseUrl = 'baseUrl';
  static const String configKeyApiKey = 'apiKey';
  static const String configKeyTimeout = 'timeout';
  static const String configKeyMaxRetries = 'maxRetries';
  static const String configKeyHeaders = 'headers';
  static const String configKeyParameters = 'parameters';
  
  // 模型能力
  static const int defaultContextLength = 4096;
  static const double defaultTemperature = 0.7;
  static const int defaultMaxTokens = 1000;
  static const double defaultTopP = 1.0;
  
  // 存储键
  static const String providerType = 'ai_provider_type';
  static const String openaiApiKey = 'openai_api_key';
  static const String openaiBaseUrl = 'openai_base_url';
  static const String ollamaBaseUrl = 'ollama_base_url';
  static const String ollamaClientSideMode = 'ollama_client_side_mode';
  static const String selectedModel = 'ai_selected_model';
  static const String selectedModelOpenAI = 'ai_selected_model_openai';
  static const String selectedModelOllama = 'ai_selected_model_ollama';
  static const String temperature = 'ai_temperature';
  static const String enableStreaming = 'ai_enable_streaming';
  static const String chatShowTopicPanel = 'chat_show_topic_panel';
  static const String chatTopics = 'chat_topics';
  static const String chatSessions = 'chat_sessions';
  static const String chatSelectedSessionId = 'chat_selected_session_id';
  static const String chatSessionTopicMap = 'chat_session_topic_map';
  static const String chatMessagesPrefix = 'chat_messages_';
}