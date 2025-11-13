import 'dart:async';
import 'dart:io';

import 'package:peers_touch_network_client/src/core/stun/stun_config.dart';
import 'package:peers_touch_network_client/src/core/stun/stun_client.dart';
import 'package:peers_touch_network_client/src/core/stun/stun_peer_info.dart';
import 'package:peers_touch_network_client/src/core/stun/stun_types.dart';
import 'package:peers_touch_network_client/src/core/stun/tun_manager.dart';
import 'package:peers_touch_network_client/src/core/stun/hole_punching.dart';

/// STUN穿透管理器
/// 
/// 负责管理STUN客户端、TUN管理器和NAT发现功能
class StunManager {
  final StunConfig config;
  
  late final List<StunClient> _stunClients;
  late final TunManager _tunManager;
  late final NatDiscovery _natDiscovery;
  late final HolePunchingCoordinator _holePunchingCoordinator;
  
  bool _initialized = false;
  
  StunManager({
    required this.config,
  });

  /// 初始化STUN管理器
  Future<void> initialize() async {
    if (_initialized) return;

    try {
      // 初始化STUN客户端
      _stunClients = await _initializeStunClients();
      
      // 初始化TUN管理器
      _tunManager = TunManager(
        config: config,
        stunClient: _stunClients.first,
      );
      
      // 初始化NAT发现器
      _natDiscovery = NatDiscovery(
        config: config,
        stunClients: _stunClients,
      );
      
      // 初始化打洞协调器
      _holePunchingCoordinator = HolePunchingCoordinator(
        config: config,
        tunManager: _tunManager,
        natDiscovery: _natDiscovery,
      );
      
      _initialized = true;
      print('STUN manager initialized successfully');
    } catch (e) {
      throw Exception('Failed to initialize STUN manager: $e');
    }
  }

  /// 初始化STUN客户端
  Future<List<StunClient>> _initializeStunClients() async {
    final clients = <StunClient>[];
    
    for (final server in config.stunServers) {
      try {
        InternetAddress? address = InternetAddress.tryParse(server);
        if (address == null) {
          final addresses = await InternetAddress.lookup(server);
          address = addresses.first;
        }
        
        final client = StunClient(
          config: config,
          stunServer: address,
          stunPort: config.stunPort,
        );
        
        await client.initialize();
        clients.add(client);
        print('Initialized STUN client for server: $server');
      } catch (e) {
        print('Failed to initialize STUN client for server $server: $e');
      }
    }
    
    if (clients.isEmpty) {
      throw Exception('No STUN clients could be initialized');
    }
    
    return clients;
  }

  /// 获取公网地址
  Future<StunResponse> getPublicAddress() async {
    _ensureInitialized();
    
    // 尝试所有STUN客户端
    for (final client in _stunClients) {
      try {
        final response = await client.getPublicAddress();
        if (response.success) {
          return response;
        }
      } catch (e) {
        print('STUN client failed: $e');
      }
    }
    
    return StunResponse(
      success: false,
      errorMessage: 'All STUN clients failed',
    );
  }

  /// 发现NAT类型
  Future<NatDiscoveryResult> discoverNatType() async {
    _ensureInitialized();
    return await _natDiscovery.discoverNatType();
  }

  /// 建立P2P连接
  Future<PeerConnection> establishP2PConnection(StunPeerInfo peer) async {
    _ensureInitialized();
    
    try {
      // 首先尝试标准打洞
      final connection = await _tunManager.establishConnection(peer);
      print('P2P connection established with peer: ${peer.id}');
      return connection;
    } catch (e) {
      print('Standard P2P connection failed: $e');
      
      // 如果标准打洞失败，尝试协调打洞
      final localPeer = StunPeerInfo(
        id: 'local',
        address: '', // 将在打洞过程中确定
        port: 0,
        publicKey: '', // 实际的公钥应该在配置中
      );
      
      final success = await _holePunchingCoordinator.coordinateHolePunching(
        localPeer,
        peer,
      );
      
      if (!success) {
        throw Exception('All P2P connection attempts failed');
      }
      
      // 重试标准连接
      return await _tunManager.establishConnection(peer);
    }
  }

  /// 获取连接状态
  Map<String, dynamic> getConnectionStatus() {
    _ensureInitialized();
    
    return {
      'stunClients': _stunClients.length,
      'activeConnections': _tunManager.activeConnections.length,
      'initialized': _initialized,
    };
  }

  /// 关闭所有连接
  Future<void> shutdown() async {
    if (!_initialized) return;

    try {
      // 关闭TUN管理器
      await _tunManager.closeAll();
      
      // 关闭STUN客户端
      for (final client in _stunClients) {
        await client.close();
      }
      
      _initialized = false;
      print('STUN manager shutdown completed');
    } catch (e) {
      print('Error during STUN manager shutdown: $e');
    }
  }

  /// 确保已初始化
  void _ensureInitialized() {
    if (!_initialized) {
      throw StateError('STUN manager not initialized');
    }
  }

  // Getters
  List<StunClient> get stunClients => List.unmodifiable(_stunClients);
  TunManager get tunManager => _tunManager;
  NatDiscovery get natDiscovery => _natDiscovery;
  HolePunchingCoordinator get holePunchingCoordinator => _holePunchingCoordinator;
  bool get isInitialized => _initialized;
}