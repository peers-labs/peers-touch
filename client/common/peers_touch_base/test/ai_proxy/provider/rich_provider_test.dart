
import 'dart:convert';

import 'package:peers_touch_base/ai_proxy/client/chat_client.dart';
import 'package:peers_touch_base/ai_proxy/model/rich_model.dart';
import 'package:peers_touch_base/ai_proxy/provider/rich_provider.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart' as pb;
import 'package:peers_touch_base/model/exception/provider_exceptions.dart';
import 'package:test/test.dart';

void main() {
  group('RichProvider', () {
    // A valid base provider for tests
    pb.Provider createTestProvider({
      String id = 'openai',
      String name = 'OpenAI',
      String sourceType = 'openai',
      String configJson =
          '{"models": [{"id": "gpt-3.5-turbo", "name": "GPT-3.5"}]}',
      String settingsJson = '{"apiKey": "test-key"}',
    }) {
      return pb.Provider(
        id: id,
        name: name,
        sourceType: sourceType,
        configJson: configJson,
        settingsJson: settingsJson,
      );
    }

    group('Constructor and Validation', () {
      test('should create successfully with valid configuration', () {
        final provider = createTestProvider();
        expect(() => RichProvider(provider), returnsNormally);
      });

      test('should throw InvalidProviderConfigException for empty ID', () {
        final provider = createTestProvider(id: '');
        expect(() => RichProvider(provider),
            throwsA(isA<InvalidProviderConfigException>()));
      });

      test('should throw InvalidProviderConfigException for empty name', () {
        final provider = createTestProvider(name: '');
        expect(() => RichProvider(provider),
            throwsA(isA<InvalidProviderConfigException>()));
      });

      test('should throw InvalidProviderConfigException for empty sourceType',
          () {
        final provider = createTestProvider(sourceType: '');
        expect(() => RichProvider(provider),
            throwsA(isA<InvalidProviderConfigException>()));
      });

      test('should throw InvalidModelsException for invalid configJson', () {
        final provider = createTestProvider(configJson: 'invalid-json');
        expect(() => RichProvider(provider),
            throwsA(isA<InvalidModelsException>()));
      });

      test('should throw InvalidProviderConfigException for invalid settingsJson',
          () {
        final provider = createTestProvider(settingsJson: 'invalid-json');
        expect(() => RichProvider(provider),
            throwsA(isA<InvalidProviderConfigException>()));
      });
    });

    group('JSON Parsing', () {
      test('_parseModelsFromJson should parse valid JSON', () {
        final json =
            '{"models": [{"id": "model-1", "name": "Model 1", "capabilities": ["chat"]}]}';
        final models = parseModelsFromJson(json, 'provider-1');
        expect(models, isA<List<RichModel>>());
        expect(models.length, 1);
        expect(models.first.id, 'model-1');
        expect(models.first.name, 'Model 1');
        expect(models.first.supportsCapability('chat'), isTrue);
      });

      test('_parseModelsFromJson should return empty list for empty JSON', () {
        final models = parseModelsFromJson('', 'provider-1');
        expect(models, isEmpty);
      });

      test('_parseModelsFromJson should throw for invalid JSON', () {
        expect(() => parseModelsFromJson('invalid', 'provider-1'),
            throwsA(isA<InvalidModelsException>()));
      });

      test('_parseApiKey should parse valid JSON', () {
        final apiKey = parseApiKey('{"apiKey": "my-key"}');
        expect(apiKey, 'my-key');
      });

      test('_parseApiKey should return empty string for missing key', () {
        final apiKey = parseApiKey('{}');
        expect(apiKey, isEmpty);
      });

      test('_parseApiKey should return empty string for invalid JSON', () {
        final apiKey = parseApiKey('invalid');
        expect(apiKey, isEmpty);
      });
    });

    group('Properties and Methods', () {
      test('isValid should be true for valid provider', () {
        final richProvider = RichProvider(createTestProvider());
        expect(richProvider.isValid, isTrue);
      });


      test('hasAvailableModels should be true when models exist', () {
        final richProvider = RichProvider(createTestProvider());
        expect(richProvider.hasAvailableModels, isTrue);
      });

      test('hasAvailableModels should be false when no models exist', () {
        final richProvider =
            RichProvider(createTestProvider(configJson: '{"models": []}'));
        expect(richProvider.hasAvailableModels, isFalse);
      });

      test('supportsModel should work correctly', () {
        final richProvider = RichProvider(createTestProvider());
        expect(richProvider.supportsModel('gpt-3.5-turbo'), isTrue);
        expect(richProvider.supportsModel('non-existent-model'), isFalse);
      });

      test('defaultModel should return the first model or null', () {
        final richProvider = RichProvider(createTestProvider());
        expect(richProvider.defaultModel, isNotNull);
        expect(richProvider.defaultModel!.id, 'gpt-3.5-turbo');

        final noModelProvider =
            RichProvider(createTestProvider(configJson: '{"models": []}'));
        expect(noModelProvider.defaultModel, isNull);
      });

      test('testConnection should be true for valid config', () async {
        final richProvider = RichProvider(createTestProvider());
        expect(await richProvider.testConnection(), isTrue);
      });

      test('testConnection should be false for missing API key', () async {
        final richProvider =
            RichProvider(createTestProvider(settingsJson: '{}'));
        expect(await richProvider.testConnection(), isFalse);
      });
    });

    group('createChatClient', () {
      test('should create a client for a supported provider', () {
        final richProvider = RichProvider(createTestProvider(id: 'openai'));
        final client = richProvider.createChatClient('gpt-3.5-turbo');
        expect(client, isA<ChatClient>());
      });


      test('should throw InvalidApiKeyException if API key is missing', () {
        final richProvider =
            RichProvider(createTestProvider(settingsJson: '{}'));
        expect(() => richProvider.createChatClient('gpt-3.5-turbo'),
            throwsA(isA<InvalidApiKeyException>()));
      });

      test('should throw InvalidModelsException for non-existent model', () {
        final richProvider = RichProvider(createTestProvider());
        expect(() => richProvider.createChatClient('non-existent-model'),
            throwsA(isA<InvalidModelsException>()));
      });

      test('should throw UnsupportedOperationException for unsupported provider',
          () {
        final richProvider =
            RichProvider(createTestProvider(id: 'unsupported-provider'));
        expect(() => richProvider.createChatClient('gpt-3.5-turbo'),
            throwsA(isA<UnsupportedOperationException>()));
      });
    });
  });
}
