import 'package:desktop/model/ai_provider_model.dart';
import 'package:flutter/foundation.dart';

abstract class AIProviderStateInterface extends ChangeNotifier {
  List<AiProvider> get providers;
  List<AiProvider> get enabledProviders;
  List<AiProvider> get disabledProviders;
  bool get isLoading;
  String? get error;
  AiProvider? get selectedProvider;
  bool get isRefreshing;

  Future<void> loadProviders();
  Future<void> refreshProviders();
  Future<void> addProvider(CreateProviderRequest request);
  Future<void> updateProvider(String id, UpdateProviderRequest request);
  Future<void> deleteProvider(String id);
  Future<void> toggleProvider(String id, bool enabled);
  Future<void> updateProviderConfig(String id, ProviderConfig config);
  Future<TestProviderResponse> testProviderConnection(String id);
  void selectProvider(String id);
  void clearError();
  AiProvider? getProviderInfo(String id);
}