
import 'package:peers_touch_base/ai_proxy/model/rich_model.dart';
import 'package:test/test.dart';

void main() {
  group('RichModel', () {
    test('should correctly identify capabilities', () {
      final model = RichModel(
        id: '1',
        providerId: 'provider-1',
        name: 'Test Model',
        description: 'A model for testing',
        capabilities: {'textInput', 'imageInput'},
      );

      expect(model.supportsTextInput, isTrue);
      expect(model.supportsImageInput, isTrue);
      expect(model.supportsAudioInput, isFalse);
      expect(model.supportsFileInput, isFalse);
    });

    test('isMultiModal should be true when there are multiple capabilities', () {
      final model = RichModel(
        id: '1',
        providerId: 'provider-1',
        name: 'Test Model',
        description: 'A model for testing',
        capabilities: {'textInput', 'imageInput'},
      );

      expect(model.isMultiModal, isTrue);
    });

    test('isMultiModal should be false when there is only one capability', () {
      final model = RichModel(
        id: '1',
        providerId: 'provider-1',
        name: 'Test Model',
        description: 'A model for testing',
        capabilities: {'textInput'},
      );

      expect(model.isMultiModal, isFalse);
    });

    test('supportsCapability should return correct values', () {
      final model = RichModel(
        id: '1',
        providerId: 'provider-1',
        name: 'Test Model',
        description: 'A model for testing',
        capabilities: {'textInput', 'imageInput'},
      );

      expect(model.supportsCapability('textInput'), isTrue);
      expect(model.supportsCapability('imageInput'), isTrue);
      expect(model.supportsCapability('audioInput'), isFalse);
      expect(model.supportsCapability('fileInput'), isFalse);
      expect(model.supportsCapability('someOtherCapability'), isFalse);
    });
  });
}
