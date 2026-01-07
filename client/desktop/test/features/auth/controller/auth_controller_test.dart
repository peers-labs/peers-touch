import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/services/network_initializer.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';

// Mock LocalStorage
class MockLocalStorage implements LocalStorage {
  final Map<String, dynamic> _storage = {};

  @override
  Future<T?> get<T>(String key) async {
    return _storage[key] as T?;
  }

  @override
  Future<void> set<T>(String key, T value) async {
    _storage[key] = value;
  }

  @override
  Future<void> remove(String key) async {
    _storage.remove(key);
  }

  @override
  Future<void> clear() async {
    _storage.clear();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    LocalStorage.mockInstance = MockLocalStorage();
    try {
      // Mock NetworkInitializer
      NetworkInitializer.initialize(baseUrl: 'http://localhost:18080');
    } catch (_) {}
  });

  tearDown(() {
    LocalStorage.mockInstance = null;
  });

  test('selectHighlightedItem populates email when user has email', () {
    final controller = AuthController();
    
    // Initialize controller (mimic GetX lifecycle)
    controller.onInit();

    // Populate presetUsers manually
    controller.presetUsers.assignAll([
      {
        'username': 'desktop-1', 
        'email': 'desktop-1@station.local',
        'name': 'Desktop One'
      },
      {
        'username': 'user2',
        // No email
      }
    ]);

    // Case 1: Select user with email
    controller.selectHighlightedItem('desktop-1');
    expect(controller.emailController.text, equals('desktop-1@station.local'));

    // Case 2: Select user without email
    controller.selectHighlightedItem('user2');
    // Should fallback to station.local
    expect(controller.emailController.text, equals('user2@station.local'));
  });
  
  test('selectHighlightedItem appends station.local if email missing', () {
    final controller = AuthController();
    controller.onInit();
    
    controller.presetUsers.assignAll([
      {'username': 'desktop-1', 'email': 'mail@example.com'}
    ]);

    // Select unknown user
    controller.selectHighlightedItem('unknown');
    expect(controller.emailController.text, equals('unknown@station.local'));
  });
}
