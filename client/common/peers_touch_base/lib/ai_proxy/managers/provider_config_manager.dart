import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:peers_touch_base/ai_proxy/models/provider_config.dart';
import 'package:yaml/yaml.dart';

/// Manages the configuration of AI providers.
///
/// This class is responsible for loading, saving, and managing the
/// CRUD (Create, Read, Update, Delete) operations for AI provider configurations.
/// Configurations are persisted to a YAML file.
class ProviderConfigManager {
  List<ProviderConfig> _configs = [];
  String? _configPath;

  /// Loads provider configurations from a YAML file.
  ///
  /// The [path] is the filesystem path to the YAML configuration file.
  Future<void> loadFromFile(String path) async {
    _configPath = path;
    final file = File(path);
    if (!await file.exists()) {
      _configs = [];
      return;
    }
    final content = await file.readAsString();
    final yaml = loadYaml(content);
    if (yaml != null && yaml['providers'] is YamlList) {
      _configs = (yaml['providers'] as YamlList)
          .map((item) => ProviderConfig.fromJson(Map<String, dynamic>.from(item)))
          .toList();
    }
  }

  /// Saves the current provider configurations to the YAML file.
  Future<void> saveToFile() async {
    if (_configPath == null) {
      throw StateError("Configuration path not set. Call loadFromFile first.");
    }
    final file = File(_configPath!);
    final data = {
      'providers': _configs.map((c) => c.toJson()).toList(),
    };
    // Note: A proper YAML emitter should be used for formatting, but for simplicity
    // we convert to JSON and then a basic string representation.
    // For robust YAML, a library like `yaml_edit` would be better.
    final jsonString = json.encode(data);
    final yamlString = json.decode(jsonString); // Basic conversion
    await file.writeAsString(json.encode(yamlString));
  }

  /// Adds a new provider configuration and saves it.
  Future<void> addProvider(ProviderConfig config) async {
    if (_configs.any((c) => c.id == config.id)) {
      throw ArgumentError("Provider with id ${config.id} already exists.");
    }
    _configs.add(config);
    await saveToFile();
  }

  /// Updates an existing provider configuration and saves it.
  Future<void> updateProvider(ProviderConfig config) async {
    final index = _configs.indexWhere((c) => c.id == config.id);
    if (index == -1) {
      throw ArgumentError("Provider with id ${config.id} not found.");
    }
    _configs[index] = config;
    await saveToFile();
  }

  /// Deletes a provider configuration by its ID and saves the changes.
  Future<void> deleteProvider(String providerId) async {
    _configs.removeWhere((c) => c.id == providerId);
    await saveToFile();
  }

  /// Returns a list of all provider configurations.
  List<ProviderConfig> listProviderConfigs() {
    return List.unmodifiable(_configs);
  }

  /// Gets a specific provider configuration by its ID.
  ProviderConfig? getProviderConfig(String providerId) {
    try {
      return _configs.firstWhere((c) => c.id == providerId);
    } catch (e) {
      return null;
    }
  }
}