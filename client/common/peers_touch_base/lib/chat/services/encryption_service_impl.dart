import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:peers_touch_base/chat/services/encryption_service.dart';
import 'package:peers_touch_base/storage/local_storage.dart';

/// 端到端加密服务实现
/// 使用X25519密钥交换 + AES-GCM加密
class EncryptionServiceImpl implements EncryptionService {
  
  EncryptionServiceImpl(this._localStorage);
  static const String _keyPrefix = 'chat_encryption_';
  static const String _keyPairKey = '${_keyPrefix}key_pair';
  static const String _sharedKeysKey = '${_keyPrefix}shared_keys';
  
  final LocalStorage _localStorage;
  final AesGcm _aesGcm = AesGcm.with256bits();
  final X25519 _x25519 = X25519();
  
  SimpleKeyPair? _keyPair;
  Map<String, SecretKey> _sharedKeys = {};

  @override
  Future<KeyPair> generateKeyPair() async {
    _keyPair = await _x25519.newKeyPair();
    await _saveKeyPair();
    return _keyPair!;
  }

  @override
  Future<String> getPublicKey() async {
    if (_keyPair == null) {
      await _loadKeyPair();
    }
    
    if (_keyPair == null) {
      await generateKeyPair();
    }
    
    final publicKey = await _keyPair!.extractPublicKey();
    return base64Encode(publicKey.bytes);
  }

  @override
  Future<String> getPrivateKey() async {
    if (_keyPair == null) {
      await _loadKeyPair();
    }
    
    if (_keyPair == null) {
      await generateKeyPair();
    }
    
    final privateKeyBytes = await _keyPair!.extractPrivateKeyBytes();
    return base64Encode(privateKeyBytes);
  }

  @override
  Future<String> encryptMessage(String content, String recipientPublicKey) async {
    try {
      // 获取与接收者的共享密钥
      final sharedKey = await _getSharedKey(recipientPublicKey);
      
      // 生成随机nonce
      final nonce = _aesGcm.newNonce();
      
      // 加密内容
      final contentBytes = utf8Encode(content);
      final secretBox = await _aesGcm.encrypt(
        contentBytes,
        secretKey: sharedKey,
        nonce: nonce,
      );
      
      // 组合nonce和密文
      final encryptedData = Uint8List.fromList([
        ...nonce.bytes,
        ...secretBox.cipherText,
      ]);
      
      return base64Encode(encryptedData);
    } catch (e) {
      throw EncryptionException('Failed to encrypt message: $e');
    }
  }

  @override
  Future<String> decryptMessage(String encryptedContent, String senderId) async {
    try {
      // 获取与发送者的共享密钥
      final sharedKey = _sharedKeys[senderId];
      if (sharedKey == null) {
        throw EncryptionException('No shared key found for sender: $senderId');
      }
      
      // 解码加密数据
      final encryptedBytes = base64Decode(encryptedContent);
      
      // 提取nonce和密文
      if (encryptedBytes.length < 12) {
        throw EncryptionException('Invalid encrypted data length');
      }
      
      final nonceBytes = encryptedBytes.sublist(0, 12);
      final cipherText = encryptedBytes.sublist(12);
      final nonce = Nonce(nonceBytes);
      
      // 解密内容
      final secretBox = SecretBox(
        cipherText,
        nonce: nonce,
        mac: Mac.empty, // MAC将在解密时验证
      );
      
      final decryptedBytes = await _aesGcm.decrypt(
        secretBox,
        secretKey: sharedKey,
      );
      
      return utf8Decode(decryptedBytes);
    } catch (e) {
      throw EncryptionException('Failed to decrypt message: $e');
    }
  }

  @override
  Future<void> performKeyExchange(String peerId, String peerPublicKey) async {
    try {
      // 获取本地私钥
      if (_keyPair == null) {
        await _loadKeyPair();
      }
      
      if (_keyPair == null) {
        await generateKeyPair();
      }
      
      // 解码对方公钥
      final peerPublicKeyBytes = base64Decode(peerPublicKey);
      final peerPublicKeyObj = SimplePublicKey(
        peerPublicKeyBytes,
        type: KeyPairType.x25519,
      );
      
      // 计算共享密钥
      final sharedSecretKey = await _x25519.sharedSecretKey(
        keyPair: _keyPair!,
        remotePublicKey: peerPublicKeyObj,
      );
      
      // 保存共享密钥
      _sharedKeys[peerId] = sharedSecretKey;
      await _saveSharedKeys();
      
    } catch (e) {
      throw EncryptionException('Failed to perform key exchange: $e');
    }
  }

  @override
  Future<bool> hasSharedKey(String peerId) async {
    return _sharedKeys.containsKey(peerId) || 
           await _localStorage.get<String>('${_keyPrefix}shared_key_$peerId') != null;
  }

  @override
  Future<Map<String, dynamic>> exportKeys() async {
    if (_keyPair == null) {
      await _loadKeyPair();
    }
    
    final keyPairData = <String, dynamic>{};
    
    if (_keyPair != null) {
      keyPairData['publicKey'] = await getPublicKey();
      keyPairData['privateKey'] = await getPrivateKey();
    }
    
    // 导出共享密钥（只导出密钥数据，不包含发送者信息）
    final sharedKeysData = <String, String>{};
    for (final entry in _sharedKeys.entries) {
      final keyBytes = await entry.value.extractBytes();
      sharedKeysData[entry.key] = base64Encode(keyBytes);
    }
    keyPairData['sharedKeys'] = sharedKeysData;
    
    return keyPairData;
  }

  @override
  Future<void> importKeys(Map<String, dynamic> keyData) async {
    try {
      // 导入密钥对
      if (keyData.containsKey('publicKey') && keyData.containsKey('privateKey')) {
        final publicKey = keyData['publicKey'] as String;
        final privateKey = keyData['privateKey'] as String;
        
        // 这里需要实现从公私钥重新构建密钥对的逻辑
        // 由于cryptography库的API限制，可能需要特殊处理
        await _saveKeyPairData(publicKey, privateKey);
      }
      
      // 导入共享密钥
      if (keyData.containsKey('sharedKeys')) {
        final sharedKeysData = keyData['sharedKeys'] as Map<String, dynamic>;
        for (final entry in sharedKeysData.entries) {
          final keyBytes = base64Decode(entry.value as String);
          final secretKey = SecretKey(keyBytes);
          _sharedKeys[entry.key] = secretKey;
        }
        await _saveSharedKeys();
      }
      
    } catch (e) {
      throw EncryptionException('Failed to import keys: $e');
    }
  }

  // ==================== 私有方法 ====================
  
  Future<SecretKey> _getSharedKey(String recipientPublicKey) async {
    // 首先检查是否已经存在共享密钥
    final recipientId = _getRecipientIdFromPublicKey(recipientPublicKey);
    if (_sharedKeys.containsKey(recipientId)) {
      return _sharedKeys[recipientId]!;
    }
    
    // 执行密钥交换
    await performKeyExchange(recipientId, recipientPublicKey);
    
    if (!_sharedKeys.containsKey(recipientId)) {
      throw EncryptionException('Failed to establish shared key');
    }
    
    return _sharedKeys[recipientId]!;
  }

  String _getRecipientIdFromPublicKey(String publicKey) {
    // 这里应该实现从公钥推导接收者ID的逻辑
    // 为了简化，暂时使用公钥的哈希值
    final publicKeyBytes = base64Decode(publicKey);
    final hash = sha256.convert(publicKeyBytes);
    return base64Encode(hash.bytes);
  }

  Future<void> _loadKeyPair() async {
    try {
      final keyPairData = await _localStorage.get<Map<String, dynamic>>(_keyPairKey);
      if (keyPairData != null) {
        // 由于cryptography库的API限制，这里需要特殊处理
        // 可能需要重新生成密钥对或从保存的数据中恢复
        await _restoreKeyPairFromData(keyPairData);
      }
    } catch (e) {
      // 如果加载失败，生成新的密钥对
      await generateKeyPair();
    }
  }

  Future<void> _saveKeyPair() async {
    if (_keyPair != null) {
      final keyPairData = {
        'publicKey': await getPublicKey(),
        'privateKey': await getPrivateKey(),
      };
      await _localStorage.set(_keyPairKey, keyPairData);
    }
  }

  Future<void> _saveKeyPairData(String publicKey, String privateKey) async {
    final keyPairData = {
      'publicKey': publicKey,
      'privateKey': privateKey,
    };
    await _localStorage.set(_keyPairKey, keyPairData);
    await _restoreKeyPairFromData(keyPairData);
  }

  Future<void> _restoreKeyPairFromData(Map<String, dynamic> keyData) async {
    // 这里需要实现从保存的数据恢复密钥对的逻辑
    // 由于cryptography库的API限制，可能需要特殊处理
    // 暂时重新生成密钥对
    await generateKeyPair();
  }

  Future<void> _loadSharedKeys() async {
    try {
      final sharedKeysData = await _localStorage.get<Map<String, dynamic>>(_sharedKeysKey);
      if (sharedKeysData != null) {
        for (final entry in sharedKeysData.entries) {
          final keyBytes = base64Decode(entry.value as String);
          final secretKey = SecretKey(keyBytes);
          _sharedKeys[entry.key] = secretKey;
        }
      }
    } catch (e) {
      _sharedKeys = {};
    }
  }

  Future<void> _saveSharedKeys() async {
    final sharedKeysData = <String, String>{};
    for (final entry in _sharedKeys.entries) {
      try {
        final keyBytes = await entry.value.extractBytes();
        sharedKeysData[entry.key] = base64Encode(keyBytes);
      } catch (e) {
        // 跳过无法导出的密钥
        continue;
      }
    }
    await _localStorage.set(_sharedKeysKey, sharedKeysData);
  }
}

class EncryptionException implements Exception {
  
  EncryptionException(this.message);
  final String message;
  
  @override
  String toString() => 'EncryptionException: $message';
}