import 'dart:typed_data';

import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/network/libp2p/core/host/host.dart';
import 'package:peers_touch_base/network/libp2p/core/peer/peer_id.dart';

/// P2P聊天协议处理器
/// 处理聊天相关的P2P消息传输
class P2PChatProtocol {
  
  P2PChatProtocol(this._host);
  static const String protocolId = '/peers-touch/chat/1.0.0';
  
  final Host _host;
  Function(PeerId, Map<String, dynamic>)? _messageHandler;

  /// 注册消息处理器
  void registerMessageHandler(Function(PeerId, Map<String, dynamic>) handler) {
    _messageHandler = handler;
    
    // 注册协议处理器
    _host.setStreamHandler(protocolId, (stream) async {
      try {
        // 读取消息数据
        final data = await _readMessageFromStream(stream);
        if (data != null && _messageHandler != null) {
          final peerId = stream.conn.remotePeer;
          _messageHandler!(peerId, data);
        }
      } catch (e) {
        LoggingService.error('Error handling P2P chat message: $e');
      } finally {
        await stream.close();
      }
    });
  }

  /// 发送消息到指定对等节点
  Future<void> sendMessage(String peerId, Map<String, dynamic> data) async {
    try {
      final remotePeerId = PeerId.fromString(peerId);
      
      // 建立连接
      final stream = await _host.newStream(remotePeerId, protocolId);
      
      // 发送消息数据
      await _writeMessageToStream(stream, data);
      
      // 关闭连接
      await stream.close();
      
    } catch (e) {
      throw P2PChatException('Failed to send message to $peerId: $e');
    }
  }

  /// 广播消息到多个对等节点
  Future<void> broadcastMessage(List<String> peerIds, Map<String, dynamic> data) async {
    final futures = <Future<void>>[];
    
    for (final peerId in peerIds) {
      futures.add(sendMessage(peerId, data));
    }
    
    // 并行发送，但不需要等待全部完成
    Future.wait(futures, eagerError: false);
  }

  /// 从流中读取消息
  Future<Map<String, dynamic>?> _readMessageFromStream(dynamic stream) async {
    try {
      // 读取消息长度（4字节）
      final lengthBytes = await _readBytes(stream, 4);
      if (lengthBytes == null || lengthBytes.length != 4) {
        return null;
      }
      
      final messageLength = ByteData.sublistView(lengthBytes).getUint32(0);
      
      // 读取消息数据
      final messageBytes = await _readBytes(stream, messageLength);
      if (messageBytes == null) {
        return null;
      }
      
      // 解码JSON数据
      final messageJson = utf8.decode(messageBytes);
      return json.decode(messageJson) as Map<String, dynamic>;
      
    } catch (e) {
      LoggingService.error('Error reading message from stream: $e');
      return null;
    }
  }

  /// 向流中写入消息
  Future<void> _writeMessageToStream(dynamic stream, Map<String, dynamic> data) async {
    try {
      // 编码JSON数据
      final messageJson = json.encode(data);
      final messageBytes = utf8.encode(messageJson);
      
      // 写入消息长度（4字节）
      final lengthBytes = ByteData(4)..setUint32(0, messageBytes.length);
      await _writeBytes(stream, lengthBytes.buffer.asUint8List());
      
      // 写入消息数据
      await _writeBytes(stream, messageBytes);
      
    } catch (e) {
      throw P2PChatException('Failed to write message to stream: $e');
    }
  }

  /// 从流中读取指定数量的字节
  Future<Uint8List?> _readBytes(dynamic stream, int count) async {
    try {
      final buffer = BytesBuilder();
      int totalRead = 0;
      
      while (totalRead < count) {
        final chunk = await stream.read(count - totalRead);
        if (chunk == null || chunk.isEmpty) {
          return null;
        }
        
        buffer.add(chunk);
        totalRead += chunk.length;
      }
      
      return buffer.toBytes();
    } catch (e) {
      return null;
    }
  }

  /// 向流中写入字节数据
  Future<void> _writeBytes(dynamic stream, Uint8List bytes) async {
    await stream.write(bytes);
  }

  /// 关闭协议处理器
  Future<void> close() async {
    // 移除协议处理器
    _host.removeStreamHandler(protocolId);
    _messageHandler = null;
  }
}

class P2PChatException implements Exception {
  
  P2PChatException(this.message);
  final String message;
  
  @override
  String toString() => 'P2PChatException: $message';
}