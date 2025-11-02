import 'package:flutter/material.dart';
import 'package:desktop/models/ai_provider.dart';

abstract class AIProviderStateInterface with ChangeNotifier {
  List<AIProvider> get providers;
  List<ProviderInfo> get providerInfos;
  List<AIProvider> get enabledProviders;
  List<AIProvider> get disabledProviders;
  AIProvider? get selectedProvider;
  bool get isLoading;
  String? get error;

  void selectProvider(AIProvider provider);
  Future<void> toggleProvider(AIProvider provider);
  Future<void> updateProviderConfig(String providerId, Map<String, dynamic> config);
  Future<bool> testProviderConnection(String providerId);
  ProviderInfo? getProviderInfo(String providerId);
  void clearError();
  Future<void> refreshProviders();
}...
