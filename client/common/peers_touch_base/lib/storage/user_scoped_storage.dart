import 'package:peers_touch_base/storage/connection/connection.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_base/storage/secure_storage.dart';

class UserScopedStorage {
  factory UserScopedStorage() => _instance;
  UserScopedStorage._internal();
  static final UserScopedStorage _instance = UserScopedStorage._internal();

  String? _currentUserHandle;
  
  String? get currentUserHandle => _currentUserHandle;

  void setCurrentUser(String? userHandle) {
    if (_currentUserHandle == userHandle) return;
    _currentUserHandle = userHandle;
    
    if (userHandle != null) {
      LocalStorage().setUserScope(userHandle);
      SecureStorage secureStorage = SecureStorageImpl();
      if (secureStorage is SecureStorageImpl) {
        secureStorage.setUserScope(userHandle);
      }
    }
  }

  void clearCurrentUser() {
    setCurrentUser(null);
  }
}
