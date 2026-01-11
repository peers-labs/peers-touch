import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/model/domain/social/post.pb.dart';

void main() {
  group('Proto Serialization Tests', () {
    test('CreatePostRequest with text should serialize correctly', () {
      // Create a text post request
      final request = CreatePostRequest(
        type: PostType.TEXT,
        visibility: PostVisibility.PUBLIC,
      );
      request.text = CreateTextPostRequest(
        text: 'Hello World',
      );

      // Serialize to bytes
      final bytes = request.writeToBuffer();
      
      print('Serialized bytes length: ${bytes.length}');
      print('Serialized bytes: $bytes');
      
      // Deserialize back
      final deserialized = CreatePostRequest.fromBuffer(bytes);
      
      // Verify
      expect(deserialized.type, PostType.TEXT);
      expect(deserialized.visibility, PostVisibility.PUBLIC);
      expect(deserialized.hasText(), true);
      expect(deserialized.text.text, 'Hello World');
      
      print('✓ Text post serialization works correctly');
    });

    test('CreatePostRequest with image should serialize correctly', () {
      final request = CreatePostRequest(
        type: PostType.IMAGE,
        visibility: PostVisibility.PUBLIC,
      );
      request.image = CreateImagePostRequest(
        text: 'Image post',
        imageIds: ['img1', 'img2'],
      );

      final bytes = request.writeToBuffer();
      final deserialized = CreatePostRequest.fromBuffer(bytes);
      
      expect(deserialized.type, PostType.IMAGE);
      expect(deserialized.hasImage(), true);
      expect(deserialized.image.text, 'Image post');
      expect(deserialized.image.imageIds, ['img1', 'img2']);
      
      print('✓ Image post serialization works correctly');
    });

    test('Empty text should serialize correctly', () {
      final request = CreatePostRequest(
        type: PostType.TEXT,
        visibility: PostVisibility.PUBLIC,
      );
      request.text = CreateTextPostRequest(
        text: '',
      );

      final bytes = request.writeToBuffer();
      print('Empty text bytes: $bytes');
      
      final deserialized = CreatePostRequest.fromBuffer(bytes);
      expect(deserialized.hasText(), true);
      expect(deserialized.text.text, '');
      
      print('✓ Empty text serialization works correctly');
    });

    test('Actual failing case - asdfasdf (no replyToPostId)', () {
      // Don't set replyToPostId at all
      final request = CreatePostRequest(
        type: PostType.TEXT,
        visibility: PostVisibility.PUBLIC,
      );
      request.text = CreateTextPostRequest(
        text: 'asdfasdf',
      );

      final bytes = request.writeToBuffer();
      print('Actual bytes sent: $bytes');
      print('Bytes length: ${bytes.length}');
      
      // Should NOT have field 3 (replyToPostId)
      // Expected: [8, 0, 16, 0, 82, 10, 10, 8, 97, 115, 100, 102, 97, 115, 100, 102]
      expect(bytes.length, 16);
      expect(bytes.contains(26), false, reason: 'Should not contain field 3 tag (26)');
      
      final deserialized = CreatePostRequest.fromBuffer(bytes);
      expect(deserialized.hasText(), true);
      expect(deserialized.text.text, 'asdfasdf');
      expect(deserialized.replyToPostId, '');
      
      print('✓ Actual case serialization works correctly (no replyToPostId)');
    });

    test('With empty replyToPostId should not serialize it', () {
      final request = CreatePostRequest(
        type: PostType.TEXT,
        visibility: PostVisibility.PUBLIC,
      );
      // Explicitly set to empty string
      request.replyToPostId = '';
      request.text = CreateTextPostRequest(text: 'test');

      final bytes = request.writeToBuffer();
      print('With empty replyToPostId bytes: $bytes');
      
      // Proto3 should NOT serialize empty strings
      expect(bytes.contains(26), false, reason: 'Empty string should not be serialized');
      
      print('✓ Empty replyToPostId not serialized');
    });
  });
}
