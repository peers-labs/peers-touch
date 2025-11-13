import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:peers_touch_network_client/src/core/stun/stun_config.dart';
import 'package:peers_touch_network_client/src/core/stun/stun_types.dart';

/// STUN客户端核心实现
class StunClient {
  final StunConfig config;
  final InternetAddress stunServer;
  final int stunPort;
  
  RawDatagramSocket? _socket;
  final Map<String, Completer<StunResponse>> _pendingRequests = {};
  Timer? _keepAliveTimer;
  
  StunClient({
    required this.config,
    required this.stunServer,
    this.stunPort = 3478,
  });

  /// 初始化STUN客户端
  Future<void> initialize() async {
    _socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
    _socket?.listen(_handleIncomingMessage);
    
    // 启动保持活跃定时器
    if (config.keepAliveInterval > 0) {
      _startKeepAliveTimer();
    }
  }

  /// 获取公网地址
  Future<StunResponse> getPublicAddress() async {
    if (_socket == null) {
      throw StateError('STUN client not initialized');
    }

    final transactionId = _generateTransactionId();
    final request = StunMessage(
      type: StunMessageType.bindingRequest,
      transactionId: transactionId,
    );

    final completer = Completer<StunResponse>();
    _pendingRequests[_transactionIdToString(transactionId)] = completer;

    try {
      final requestBytes = request.toBytes();
      _socket?.send(requestBytes, stunServer, stunPort);
      
      // 设置超时
      Timer(Duration(milliseconds: config.holePunchTimeout), () {
        if (!completer.isCompleted) {
          completer.complete(StunResponse(
            success: false,
            errorMessage: 'STUN request timeout',
          ));
          _pendingRequests.remove(_transactionIdToString(transactionId));
        }
      });

      return await completer.future;
    } catch (e) {
      _pendingRequests.remove(_transactionIdToString(transactionId));
      rethrow;
    }
  }

  /// 关闭STUN客户端
  Future<void> close() async {
    _keepAliveTimer?.cancel();
    _keepAliveTimer = null;
    
    _pendingRequests.forEach((_, completer) {
      if (!completer.isCompleted) {
        completer.complete(StunResponse(
          success: false,
          errorMessage: 'STUN client closed',
        ));
      }
    });
    _pendingRequests.clear();
    
    _socket?.close();
    _socket = null;
  }

  /// 启动保持活跃定时器
  void _startKeepAliveTimer() {
    _keepAliveTimer = Timer.periodic(
      Duration(milliseconds: config.keepAliveInterval),
      (_) => _keepAlive(),
    );
  }

  /// 保持NAT映射活跃
  Future<void> _keepAlive() async {
    try {
      await getPublicAddress();
    } catch (e) {
      // 保持活跃失败，但不影响主要功能
      print('STUN keep-alive failed: $e');
    }
  }

  /// 处理传入消息
  void _handleIncomingMessage(RawSocketEvent event) {
    if (event != RawSocketEvent.read) return;
    
    final datagram = _socket?.receive();
    if (datagram == null) return;
    
    try {
      final message = StunMessage.fromBytes(datagram.data);
      _handleStunMessage(message);
    } catch (e) {
      print('Failed to parse STUN message: $e');
    }
  }

  /// 处理STUN消息
  void _handleStunMessage(StunMessage message) {
    final transactionId = _transactionIdToString(message.transactionId);
    final completer = _pendingRequests.remove(transactionId);
    
    if (completer == null) {
      // 未知的交易ID，可能是响应延迟或错误
      return;
    }

    if (message.type == StunMessageType.bindingResponse) {
      _handleBindingResponse(message, completer);
    } else if (message.type == StunMessageType.bindingErrorResponse) {
      _handleBindingErrorResponse(message, completer);
    } else {
      completer.complete(StunResponse(
        success: false,
        errorMessage: 'Unexpected STUN message type: ${message.type}',
      ));
    }
  }

  /// 处理绑定响应
  void _handleBindingResponse(
    StunMessage message,
    Completer<StunResponse> completer,
  ) {
    try {
      // 解析XOR-MAPPED-ADDRESS属性
      final xorMappedAddress = message.attributes[StunAttributeType.xorMappedAddress];
      if (xorMappedAddress != null && xorMappedAddress.length >= 8) {
        final address = _parseXorMappedAddress(xorMappedAddress, message.transactionId);
        completer.complete(StunResponse(
          success: true,
          publicAddress: address.address,
          publicPort: address.port,
          attributes: _convertAttributesToMap(message.attributes),
        ));
        return;
      }

      // 回退到MAPPED-ADDRESS属性
      final mappedAddress = message.attributes[StunAttributeType.mappedAddress];
      if (mappedAddress != null && mappedAddress.length >= 8) {
        final address = _parseMappedAddress(mappedAddress);
        completer.complete(StunResponse(
          success: true,
          publicAddress: address.address,
          publicPort: address.port,
          attributes: _convertAttributesToMap(message.attributes),
        ));
        return;
      }

      completer.complete(StunResponse(
        success: false,
        errorMessage: 'No address information in STUN response',
      ));
    } catch (e) {
      completer.complete(StunResponse(
        success: false,
        errorMessage: 'Failed to parse STUN response: $e',
      ));
    }
  }

  /// 处理绑定错误响应
  void _handleBindingErrorResponse(
    StunMessage message,
    Completer<StunResponse> completer,
  ) {
    final errorCode = message.attributes[StunAttributeType.errorCode];
    String errorMessage = 'STUN binding error';
    
    if (errorCode != null && errorCode.length >= 4) {
      final code = (errorCode[2] << 8) | errorCode[3];
      final reason = errorCode.length > 4 
          ? utf8.decode(errorCode.sublist(4), allowMalformed: true)
          : '';
      errorMessage = 'STUN error $code: $reason';
    }

    completer.complete(StunResponse(
      success: false,
      errorMessage: errorMessage,
    ));
  }

  /// 解析XOR映射地址
  ({InternetAddress address, int port}) _parseXorMappedAddress(
    Uint8List data,
    Uint8List transactionId,
  ) {
    final family = data[1];
    final port = ((data[2] ^ 0x21) << 8) | (data[3] ^ 0x12);
    
    if (family == 0x01) { // IPv4
      final addrBytes = Uint8List(4);
      for (int i = 0; i < 4; i++) {
        addrBytes[i] = data[i + 4] ^ [0x21, 0x12, 0xA4, 0x42][i];
      }
      final address = InternetAddress.fromRawAddress(addrBytes);
      return (address: address, port: port);
    } else if (family == 0x02) { // IPv6
      final addrBytes = Uint8List(16);
      final magicCookie = Uint8List.fromList([0x21, 0x12, 0xA4, 0x42]);
      for (int i = 0; i < 16; i++) {
        if (i < 4) {
          addrBytes[i] = data[i + 4] ^ magicCookie[i];
        } else {
          addrBytes[i] = data[i + 4] ^ transactionId[i - 4];
        }
      }
      final address = InternetAddress.fromRawAddress(addrBytes);
      return (address: address, port: port);
    } else {
      throw ArgumentError('Unsupported address family: $family');
    }
  }

  /// 解析映射地址
  ({InternetAddress address, int port}) _parseMappedAddress(Uint8List data) {
    final family = data[1];
    final port = (data[2] << 8) | data[3];
    
    if (family == 0x01) { // IPv4
      final addrBytes = data.sublist(4, 8);
      final address = InternetAddress.fromRawAddress(addrBytes);
      return (address: address, port: port);
    } else if (family == 0x02) { // IPv6
      final addrBytes = data.sublist(4, 20);
      final address = InternetAddress.fromRawAddress(addrBytes);
      return (address: address, port: port);
    } else {
      throw ArgumentError('Unsupported address family: $family');
    }
  }

  /// 转换属性为Map
  Map<String, dynamic> _convertAttributesToMap(
    Map<StunAttributeType, Uint8List> attributes,
  ) {
    final result = <String, dynamic>{};
    for (final entry in attributes.entries) {
      final key = entry.key.toString().split('.').last;
      result[key] = entry.value;
    }
    return result;
  }

  /// 生成事务ID
  Uint8List _generateTransactionId() {
    final random = Random.secure();
    final bytes = Uint8List(12);
    for (int i = 0; i < 12; i++) {
      bytes[i] = random.nextInt(256);
    }
    return bytes;
  }

  /// 事务ID转字符串
  String _transactionIdToString(Uint8List transactionId) {
    return base64.encode(transactionId);
  }
}