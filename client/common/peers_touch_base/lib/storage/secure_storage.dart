import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// 安全存储服务接口
abstract class SecureStorage {
  Future<void> set(String key, String value);
  Future<String?> get(String key);
  Future<void> remove(String key);
  Future<void> clear();
  void setUserScope(String? userHandle);
}

/// 安全存储服务实现（基于 FlutterSecureStorage）
class SecureStorageImpl implements SecureStorage {
  SecureStorageImpl({String? userHandle}) {
    setUserScope(userHandle);
  }

  FlutterSecureStorage? _fs;
  String? _currentUserHandle;

  @override
  void setUserScope(String? userHandle) {
    if (_currentUserHandle == userHandle) return;
    _currentUserHandle = userHandle;
    
    final accountName = userHandle ?? 'global';
    _fs = FlutterSecureStorage(
      iOptions: IOSOptions(
        groupId: 'com.peerstouch',
        accountName: accountName,
      ),
      mOptions: MacOsOptions(
        groupId: 'com.peerstouch',
        accountName: accountName,
      ),
    );
  }

  @override
  Future<void> set(String key, String value) async {
    await _fs!.write(key: key, value: value);
  }

  @override
  Future<String?> get(String key) async {
    return _fs!.read(key: key);
  }

  @override
  Future<void> remove(String key) async {
    await _fs!.delete(key: key);
  }

  @override
  Future<void> clear() async {
    await _fs!.deleteAll();
  }
}