// Mock API for testing dynamic configuration fields
const mockProviders = {
  ollama: {
    name: "ollama",
    displayName: "Ollama",
    enabled: true,
    config: {
      endpoint: "http://localhost:11434",
      origins: "*"
    },
    configFields: [
      {
        name: "endpoint",
        type: "string",
        required: true,
        description: "Ollama server endpoint URL",
        envVar: "OLLAMA_ENDPOINT",
        defaultValue: "http://localhost:11434"
      },
      {
        name: "origins",
        type: "string",
        required: false,
        description: "Allowed origins for CORS",
        envVar: "OLLAMA_ORIGINS",
        defaultValue: "*"
      }
    ],
    models: [
      {
        id: "llama2",
        name: "Llama 2",
        provider: "ollama",
        type: "chat",
        description: "Meta's Llama 2 model",
        maxTokens: 4096,
        capabilities: ["chat", "completion"],
        isActive: true
      }
    ],
    status: "connected",
    error: null
  },
  openai: {
    name: "openai",
    displayName: "OpenAI",
    enabled: false,
    config: {
      api_key: "",
      proxy_url: ""
    },
    configFields: [
      {
        name: "api_key",
        type: "string",
        required: true,
        description: "OpenAI API key for authentication",
        envVar: "OPENAI_API_KEY"
      },
      {
        name: "proxy_url",
        type: "string",
        required: false,
        description: "Proxy URL for API requests (optional)",
        envVar: "OPENAI_PROXY_URL"
      }
    ],
    models: [
      {
        id: "gpt-4",
        name: "GPT-4",
        provider: "openai",
        type: "chat",
        description: "Most capable GPT-4 model",
        maxTokens: 8192,
        capabilities: ["chat", "completion"],
        pricing: {
          input: 0.03,
          output: 0.06
        },
        isActive: true
      },
      {
        id: "gpt-3.5-turbo",
        name: "GPT-3.5 Turbo",
        provider: "openai",
        type: "chat",
        description: "Fast and efficient GPT-3.5 model",
        maxTokens: 4096,
        capabilities: ["chat", "completion"],
        pricing: {
          input: 0.001,
          output: 0.002
        },
        isActive: true
      }
    ],
    status: "disconnected",
    error: null
  },
  anthropic: {
    name: "anthropic",
    displayName: "Anthropic Claude",
    enabled: false,
    config: {
      api_key: "",
      max_tokens: 1000,
      temperature: 0.7,
      stream: true
    },
    configFields: [
      {
        name: "api_key",
        type: "string",
        required: true,
        description: "Anthropic API key for authentication",
        envVar: "ANTHROPIC_API_KEY"
      },
      {
        name: "max_tokens",
        type: "number",
        required: false,
        description: "Maximum number of tokens to generate",
        defaultValue: "1000"
      },
      {
        name: "temperature",
        type: "number",
        required: false,
        description: "Sampling temperature (0.0 to 1.0)",
        defaultValue: "0.7"
      },
      {
        name: "stream",
        type: "boolean",
        required: false,
        description: "Enable streaming responses",
        defaultValue: "true"
      }
    ],
    models: [
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        provider: "anthropic",
        type: "chat",
        description: "Most powerful Claude 3 model",
        maxTokens: 200000,
        capabilities: ["chat", "completion", "analysis"],
        pricing: {
          input: 0.015,
          output: 0.075
        },
        isActive: true
      },
      {
        id: "claude-3-sonnet-20240229",
        name: "Claude 3 Sonnet",
        provider: "anthropic",
        type: "chat",
        description: "Balanced Claude 3 model",
        maxTokens: 200000,
        capabilities: ["chat", "completion", "analysis"],
        pricing: {
          input: 0.003,
          output: 0.015
        },
        isActive: true
      }
    ],
    status: "disconnected",
    error: null
  }
};

// Mock API endpoints
window.mockAPI = {
  // Get all providers
  getProviders: () => {
    return Promise.resolve({
      success: true,
      data: Object.values(mockProviders)
    });
  },

  // Get specific provider info
  getProviderInfo: (providerName) => {
    const provider = mockProviders[providerName];
    if (!provider) {
      return Promise.resolve({
        success: false,
        error: `Provider ${providerName} not found`
      });
    }
    return Promise.resolve({
      success: true,
      data: provider
    });
  },

  // Update provider config
  updateProviderConfig: (providerName, config) => {
    const provider = mockProviders[providerName];
    if (!provider) {
      return Promise.resolve({
        success: false,
        error: `Provider ${providerName} not found`
      });
    }
    
    // Simulate validation
    const configFields = provider.configFields;
    for (const field of configFields) {
      if (field.required && (!config[field.name] || config[field.name] === '')) {
        return Promise.resolve({
          success: false,
          error: `Field ${field.name} is required`
        });
      }
    }
    
    provider.config = { ...provider.config, ...config };
    return Promise.resolve({
      success: true,
      data: provider
    });
  },

  // Toggle provider enabled status
  toggleProvider: (providerName) => {
    const provider = mockProviders[providerName];
    if (!provider) {
      return Promise.resolve({
        success: false,
        error: `Provider ${providerName} not found`
      });
    }
    
    provider.enabled = !provider.enabled;
    return Promise.resolve({
      success: true,
      data: provider
    });
  },

  // Test provider connection
  testProviderConnection: (providerName) => {
    const provider = mockProviders[providerName];
    if (!provider) {
      return Promise.resolve({
        success: false,
        error: `Provider ${providerName} not found`
      });
    }
    
    // Simulate connection test
    if (provider.name === 'ollama') {
      return Promise.resolve({
        success: true,
        message: "Connection successful"
      });
    } else if (provider.config.api_key && provider.config.api_key !== '') {
      return Promise.resolve({
        success: true,
        message: "Connection successful"
      });
    } else {
      return Promise.resolve({
        success: false,
        error: "API key is required for connection test"
      });
    }
  }
};

console.log('Mock API loaded successfully');