import 'package:flutter/material.dart';

class AIProvider {
  final String id;
  final String name;
  final IconData icon;
  bool isEnabled;

  AIProvider({required this.id, required this.name, required this.icon, this.isEnabled = false});
}

class AIProviderSettings {
  String apiKey = '';
  String proxyUrl = '';
  bool useResponseApi = false;
  bool useClientRequest = false;
}