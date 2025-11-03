import 'ai_provider_state_interface.dart';

class MockAIProviderState extends AIProviderStateInterface {
  List<Map<String, dynamic>> _providers = [
    {
      'id': '1',
      'name': 'Ollama',
      'description': 'Local AI models',
      'enabled': true,
      'logo': 'assets/icons/ollama.png',
      'type': 'local',
    },
    {
      'id': '2', 
      'name': 'OpenAI GPT',
      'description': 'GPT-3.5 and GPT-4 models',
      'enabled': false,
      'logo': 'assets/icons/openai.png',
      'type': 'api',
    },
  ];
  
  bool _isLoading = false;
  String? _error;
  Map<String, dynamic>? _selectedProvider;
  
  @override
  List<Map<String, dynamic>> get providers => _providers;
  
  @override
  bool get isLoading => _isLoading;
  
  @override
  String? get error => _error;
  
  @override
  Map<String, dynamic>? get selectedProvider => _selectedProvider;
  
  @override
  Future<void> loadProviders() async {
    _isLoading = true;
    notifyListeners();
    
    // Simulate API call
    await Future.delayed(const Duration(milliseconds: 500));
    
    _isLoading = false;
    notifyListeners();
  }
  
  @override
  Future<void> addProvider(Map<String, dynamic> provider) async {
    _providers.add(provider);
    notifyListeners();
  }
  
  @override
  Future<void> updateProvider(String id, Map<String, dynamic> provider) async {
    final index = _providers.indexWhere((p) => p['id'] == id);
    if (index != -1) {
      _providers[index] = provider;
      notifyListeners();
    }
  }
  
  @override
  Future<void> deleteProvider(String id) async {
    _providers.removeWhere((p) => p['id'] == id);
    notifyListeners();
  }
  
  @override
  Future<void> toggleProvider(String id, bool enabled) async {
    final index = _providers.indexWhere((p) => p['id'] == id);
    if (index != -1) {
      _providers[index]['enabled'] = enabled;
      notifyListeners();
    }
  }
  
  @override
  Future<void> updateProviderConfig(String id, Map<String, dynamic> config) async {
    final index = _providers.indexWhere((p) => p['id'] == id);
    if (index != -1) {
      _providers[index]['config'] = config;
      notifyListeners();
    }
  }
  
  @override
  Future<bool> testProviderConnection(String id) async {
    // Simulate connection test
    await Future.delayed(const Duration(seconds: 1));
    return true; // Mock successful connection
  }
  
  @override
  void selectProvider(Map<String, dynamic> provider) {
    _selectedProvider = provider;
    notifyListeners();
  }
  
  @override
  Map<String, dynamic>? getProviderInfo(String id) {
    return _providers.firstWhere(
      (p) => p['id'] == id,
      orElse: () => {},
    );
  }
}