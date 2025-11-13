/// AI 提供商常量定义
class AIConstants {
  // OpenAI 默认配置
  static const String openaiBaseUrl = 'https://api.openai.com';
  static const String openaiDefaultModel = 'gpt-3.5-turbo';
  
  // Ollama 默认配置
  static const String ollamaBaseUrl = 'http://localhost:11434';
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
}