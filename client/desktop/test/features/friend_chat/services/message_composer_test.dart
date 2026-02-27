import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_desktop/features/friend_chat/services/message_composer.dart';
import 'package:peers_touch_desktop/features/shared/extensions/chat_message_extensions.dart';
import 'dart:io';

void main() {
  late MessageComposer composer;

  setUp(() {
    composer = MessageComposer();
  });

  group('MessageComposer', () {
    group('composeTextMessage', () {
      test('should create text message with correct fields', () {
        final message = composer.composeTextMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          content: 'Hello, World!',
        );

        expect(message.senderId, 'user1');
        expect(message.sessionId, 'session123');
        expect(message.content, 'Hello, World!');
        expect(message.type, MessageType.MESSAGE_TYPE_TEXT);
        expect(message.status, MessageStatus.MESSAGE_STATUS_SENDING);
        expect(message.id, isNotEmpty);
      });

      test('should generate unique IDs for different messages', () {
        final message1 = composer.composeTextMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          content: 'Message 1',
        );

        final message2 = composer.composeTextMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          content: 'Message 2',
        );

        expect(message1.id, isNot(equals(message2.id)));
      });

      test('should support replyToId parameter', () {
        final message = composer.composeTextMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          content: 'Reply message',
          replyToId: 'original123',
        );

        expect(message.replyToId, 'original123');
      });
    });

    group('composeImageMessage', () {
      test('should create image message with correct type', () {
        final testFile = File('/test/image.jpg');
        
        final message = composer.composeImageMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          imageFile: testFile,
        );

        expect(message.type, MessageType.MESSAGE_TYPE_IMAGE);
        expect(message.status, MessageStatus.MESSAGE_STATUS_SENDING);
      });

      test('should use caption if provided', () {
        final testFile = File('/test/image.jpg');
        
        final message = composer.composeImageMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          imageFile: testFile,
          caption: 'My vacation photo',
        );

        expect(message.content, 'My vacation photo');
      });

      test('should use filename when no caption provided', () {
        final testFile = File('/test/my_image.jpg');
        
        final message = composer.composeImageMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          imageFile: testFile,
        );

        expect(message.content, 'my_image.jpg');
      });
    });

    group('composeFileMessage', () {
      test('should create file message with correct type', () {
        final testFile = File('/test/document.pdf');
        
        final message = composer.composeFileMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          file: testFile,
        );

        expect(message.type, MessageType.MESSAGE_TYPE_FILE);
        expect(message.status, MessageStatus.MESSAGE_STATUS_SENDING);
        expect(message.content, 'document.pdf');
      });
    });

    group('composeStickerMessage', () {
      test('should create sticker message with metadata', () {
        final message = composer.composeStickerMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          stickerUrl: 'https://example.com/sticker.png',
          stickerName: 'Happy Face',
        );

        expect(message.type, MessageType.MESSAGE_TYPE_STICKER);
        expect(message.content, 'https://example.com/sticker.png');
        expect(message.metadata['stickerName'], 'Happy Face');
      });
    });

    group('composeAudioMessage', () {
      test('should create audio message without duration', () {
        final testFile = File('/test/audio.mp3');
        
        final message = composer.composeAudioMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          audioFile: testFile,
        );

        expect(message.type, MessageType.MESSAGE_TYPE_AUDIO);
        expect(message.metadata.containsKey('duration'), false);
      });

      test('should include duration in metadata when provided', () {
        final testFile = File('/test/audio.mp3');
        
        final message = composer.composeAudioMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          audioFile: testFile,
          duration: 120,
        );

        expect(message.metadata['duration'], '120');
      });
    });

    group('composeLocationMessage', () {
      test('should create location message with coordinates', () {
        final message = composer.composeLocationMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          latitude: 37.7749,
          longitude: -122.4194,
          locationName: 'San Francisco',
          address: '123 Market St',
        );

        expect(message.type, MessageType.MESSAGE_TYPE_LOCATION);
        expect(message.content, 'San Francisco');
        expect(message.metadata['latitude'], '37.7749');
        expect(message.metadata['longitude'], '-122.4194');
        expect(message.metadata['locationName'], 'San Francisco');
        expect(message.metadata['address'], '123 Market St');
      });

      test('should use default content when location name is null', () {
        final message = composer.composeLocationMessage(
          from: 'user1',
          to: 'user2',
          sessionId: 'session123',
          latitude: 37.7749,
          longitude: -122.4194,
        );

        expect(message.content, 'Location');
      });
    });

    group('composeSystemMessage', () {
      test('should create system message with correct properties', () {
        final message = composer.composeSystemMessage(
          sessionId: 'session123',
          content: 'User joined the chat',
        );

        expect(message.type, MessageType.MESSAGE_TYPE_SYSTEM);
        expect(message.senderId, 'system');
        expect(message.status, MessageStatus.MESSAGE_STATUS_SENT);
        expect(message.content, 'User joined the chat');
      });
    });
  });
}
