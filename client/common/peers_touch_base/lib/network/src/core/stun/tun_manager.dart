import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:peers_touch_network_client/src/core/stun/stun_client.dart';
import 'package:peers_touch_network_client/src/core/stun/stun_config.dart';
import 'package:peers_touch_network_client/src/core/stun/stun_peer_info.dart';

/// TUN接口抽象
abstract class TunInterface {
  /// 打开TUN接口
  Future<void> open(String interfaceName);
  
  /// 关闭TUN接口
  Future<void> close();
  
  /// 读取数据包
  Stream<Uint8List> get packets;
  
  /// 写入数据包
  Future<void> writePacket(Uint8List packet);
  
  /// 获取接口状态
  bool get isOpen;
  
  /// 获取接口名称
  String get interfaceName;
}

/// 打洞请求
class HolePunchRequest {
  final StunPeerInfo targetPeer;
  final InternetAddress? publicAddress;
  final int? publicPort;
  final Duration timeout;

  HolePunchRequest({
    required this.targetPeer,
    this.publicAddress,
    this.publicPort,
    this.timeout = const Duration(seconds: 10),
  });
}

/// 打洞响应
class HolePunchResponse {
  final bool success;
  final String? errorMessage;
  final RawDatagramSocket? socket;
  final InternetAddress? localAddress;
  final int? localPort;

  HolePunchResponse({
    required this.success,
    this.errorMessage,
    this.socket,
    this.localAddress,
    this.localPort,
  });
}

/// 对等连接
class PeerConnection {
  final StunPeerInfo peer;
  final RawDatagramSocket socket;
  final InternetAddress localAddress;
  final int localPort;
  final InternetAddress? remoteAddress;
  final int? remotePort;
  final StreamController<Uint8List> _packetController;
  
  PeerConnection({
    required this.peer,
    required this.socket,
    required this.localAddress,
    required this.localPort,
    this.remoteAddress,
    this.remotePort,
  }) : _packetController = StreamController<Uint8List>.broadcast() {
    _setupSocketListener();
  }
  
  void _setupSocketListener() {
    socket.listen((event) {
      if (event == RawSocketEvent.read) {
        final datagram = socket.receive();
        if (datagram != null) {
          _packetController.add(datagram.data);
        }
      }
    });
  }
  
  /// 数据包流
  Stream<Uint8List> get packets => _packetController.stream;
  
  /// 发送数据
  Future<void> send(Uint8List data) async {
    if (remoteAddress != null && remotePort != null) {
      socket.send(data, remoteAddress!, remotePort!);
    } else {
      throw StateError('Remote address not established');
    }
  }
  
  /// 关闭连接
  Future<void> close() async {
    _packetController.close();
    socket.close();
  }
}

/// TUN管理器
class TunManager {
  final StunConfig config;
  final StunClient stunClient;
  final TunInterface? tunInterface;
  
  final Map<String, PeerConnection> _connections = {};
  final Map<String, Timer> _keepAliveTimers = {};
  
  TunManager({
    required this.config,
    required this.stunClient,
    this.tunInterface,
  });

  /// 建立P2P连接
  Future<PeerConnection> establishConnection(StunPeerInfo peer) async {
    if (_connections.containsKey(peer.id)) {
      return _connections[peer.id]!;
    }

    // 获取本地公网地址
    final stunResponse = await stunClient.getPublicAddress();
    if (!stunResponse.success) {
      throw Exception('Failed to get public address: ${stunResponse.errorMessage}');
    }

    // 执行打洞
    final holePunchResponse = await _performHolePunching(
      HolePunchRequest(
        targetPeer: peer,
        publicAddress: stunResponse.publicAddress,
        publicPort: stunResponse.publicPort,
      ),
    );

    if (!holePunchResponse.success) {
      throw Exception('Hole punching failed: ${holePunchResponse.errorMessage}');
    }

    final connection = PeerConnection(
      peer: peer,
      socket: holePunchResponse.socket!,
      localAddress: holePunchResponse.localAddress!,
      localPort: holePunchResponse.localPort!,
      remoteAddress: InternetAddress.tryParse(peer.address),
      remotePort: peer.port,
    );

    _connections[peer.id] = connection;
    
    // 启动保持活跃
    _startKeepAlive(peer.id, connection);
    
    // 监听连接关闭
    connection.socket.listen(
      (event) {
        if (event == RawSocketEvent.closed) {
          _cleanupConnection(peer.id);
        }
      },
      onDone: () {
        _cleanupConnection(peer.id);
      },
    );

    return connection;
  }

  /// 执行打洞
  Future<HolePunchResponse> _performHolePunching(HolePunchRequest request) async {
    final completer = Completer<HolePunchResponse>();
    
    try {
      // 创建UDP套接字
      final socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      final localAddress = socket.address;
      final localPort = socket.port;
      
      // 设置套接字监听
      Timer? responseTimer;
      int attemptCount = 0;
      
      void handleDatagram() {
        final datagram = socket.receive();
        if (datagram != null) {
          // 收到响应，打洞成功
          responseTimer?.cancel();
          if (!completer.isCompleted) {
            completer.complete(HolePunchResponse(
              success: true,
              socket: socket,
              localAddress: localAddress,
              localPort: localPort,
            ));
          }
        }
      }
      
      socket.listen((event) {
        if (event == RawSocketEvent.read) {
          handleDatagram();
        }
      });
      
      // 发送打洞数据包
      void sendHolePunchPacket() {
        if (attemptCount >= config.maxRetryAttempts) {
          responseTimer?.cancel();
          if (!completer.isCompleted) {
            completer.complete(HolePunchResponse(
              success: false,
              errorMessage: 'Max retry attempts reached',
            ));
          }
          socket.close();
          return;
        }
        
        attemptCount++;
        
        // 向目标发送打洞数据包
        if (request.targetPeer.address.isNotEmpty && request.targetPeer.port > 0) {
          final targetAddress = InternetAddress.tryParse(request.targetPeer.address);
          if (targetAddress != null) {
            // 发送简单的打洞数据包
            final punchData = Uint8List.fromList([
              0x00, 0x00, 0x00, 0x00, // 魔术数字
              attemptCount & 0xFF,     // 尝试次数
              0x00, 0x00, 0x00,       // 填充
            ]);
            socket.send(punchData, targetAddress, request.targetPeer.port);
          }
        }
        
        // 设置响应超时
        responseTimer = Timer(request.timeout, () {
          if (!completer.isCompleted && attemptCount < config.maxRetryAttempts) {
            sendHolePunchPacket();
          }
        });
      }
      
      // 开始打洞过程
      sendHolePunchPacket();
      
      return await completer.future;
    } catch (e) {
      if (!completer.isCompleted) {
        completer.complete(HolePunchResponse(
          success: false,
          errorMessage: 'Hole punching error: $e',
        ));
      }
      return completer.future;
    }
  }

  /// 处理打洞请求
  Future<void> handleHolePunching(HolePunchRequest request) async {
    // 这里可以实现被动打洞逻辑
    // 当收到其他节点的打洞请求时，可以自动响应
    print('Received hole punching request from ${request.targetPeer.id}');
  }

  /// 启动保持活跃
  void _startKeepAlive(String peerId, PeerConnection connection) {
    if (config.keepAliveInterval <= 0) return;
    
    final timer = Timer.periodic(
      Duration(milliseconds: config.keepAliveInterval),
      (_) => _sendKeepAlive(peerId, connection),
    );
    
    _keepAliveTimers[peerId] = timer;
  }

  /// 发送保持活跃数据包
  Future<void> _sendKeepAlive(String peerId, PeerConnection connection) async {
    try {
      final keepAliveData = Uint8List.fromList([
        0xFF, 0xFF, 0xFF, 0xFF, // 保持活跃魔术数字
        0x00, 0x00, 0x00, 0x00, // 序列号
      ]);
      
      await connection.send(keepAliveData);
    } catch (e) {
      print('Keep-alive failed for peer $peerId: $e');
    }
  }

  /// 清理连接
  void _cleanupConnection(String peerId) {
    _keepAliveTimers[peerId]?.cancel();
    _keepAliveTimers.remove(peerId);
    _connections.remove(peerId);
  }

  /// 获取活动连接
  Map<String, PeerConnection> get activeConnections => Map.unmodifiable(_connections);

  /// 关闭所有连接
  Future<void> closeAll() async {
    for (final timer in _keepAliveTimers.values) {
      timer.cancel();
    }
    _keepAliveTimers.clear();
    
    for (final connection in _connections.values) {
      await connection.close();
    }
    _connections.clear();
  }
}