import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';

/// 端到端加密服务接口
abstract class EncryptionService {
  /// 生成密钥对
  Future<KeyPair> generateKeyPair();
  
  /// 获取公钥
  Future<String> getPublicKey();
  
  /// 获取私钥
  Future<String> getPrivateKey();
  
  /// 加密消息
  Future<String> encryptMessage(String content, String recipientPublicKey);
  
  /// 解密消息
  Future<String> decryptMessage(String encryptedContent, String senderId);
  
  /// 执行密钥交换
  Future<void> performKeyExchange(String peerId, String peerPublicKey);
  
  /// 检查是否有共享密钥
  Future<bool> hasSharedKey(String peerId);
  
  /// 导出密钥
  Future<Map<String, dynamic>> exportKeys();
  
  /// 导入密钥
  Future<void> importKeys(Map<String, dynamic> keyData);
}