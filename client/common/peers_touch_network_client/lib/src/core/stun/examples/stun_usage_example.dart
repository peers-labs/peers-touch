import 'dart:typed_data';

import 'package:peers_touch_network_client/src/core/stun/stun.dart';

/// STUN/TUN穿透功能使用示例
class StunUsageExample {
  
  /// 基本STUN使用示例
  static Future<void> basicStunExample() async {
    print('=== Basic STUN Example ===');
    
    try {
      // 创建STUN配置
      final config = StunConfig(
        stunServers: ['stun.l.google.com', 'stun1.l.google.com'],
        stunPort: 3478,
        holePunchTimeout: 5000,
        keepAliveInterval: 30000,
      );
      
      // 创建STUN管理器
      final stunManager = StunManager(config: config);
      
      // 初始化
      await stunManager.initialize();
      print('STUN manager initialized');
      
      // 获取公网地址
      final response = await stunManager.getPublicAddress();
      if (response.success) {
        print('Public address: ${response.publicAddress}:${response.publicPort}');
      } else {
        print('Failed to get public address: ${response.errorMessage}');
      }
      
      // 发现NAT类型
      final natResult = await stunManager.discoverNatType();
      print('NAT type: ${natResult.natType}');
      print('NAT description: ${natResult.description}');
      
      // 关闭管理器
      await stunManager.shutdown();
      print('STUN manager shutdown');
      
    } catch (e) {
      print('STUN example failed: $e');
    }
  }
  
  /// P2P连接示例
  static Future<void> p2pConnectionExample() async {
    print('\n=== P2P Connection Example ===');
    
    try {
      final config = StunConfig();
      final stunManager = StunManager(config: config);
      
      await stunManager.initialize();
      
      // 创建对等节点信息（示例数据）
      final peer = StunPeerInfo(
        id: 'peer-123',
        address: '192.168.1.100', // 目标节点地址
        port: 8080,
        publicKey: 'example-public-key',
        capabilities: ['p2p', 'file-sharing'],
      );
      
      // 建立P2P连接
      final connection = await stunManager.establishP2PConnection(peer);
      print('P2P connection established with peer: ${peer.id}');
      
      // 监听数据包
      connection.packets.listen((data) {
        print('Received data from peer: ${String.fromCharCodes(data)}');
      });
      
      // 发送测试数据
      final testData = Uint8List.fromList('Hello P2P!'.codeUnits);
      await connection.send(testData);
      print('Sent test data to peer');
      
      // 等待一段时间
      await Future.delayed(Duration(seconds: 5));
      
      // 关闭连接
      await connection.close();
      await stunManager.shutdown();
      
    } catch (e) {
      print('P2P connection example failed: $e');
    }
  }
  
  /// NAT发现示例
  static Future<void> natDiscoveryExample() async {
    print('\n=== NAT Discovery Example ===');
    
    try {
      final config = StunConfig();
      final stunManager = StunManager(config: config);
      
      await stunManager.initialize();
      
      // 获取详细的NAT信息
      final natResult = await stunManager.discoverNatType();
      
      print('NAT Discovery Results:');
      print('  Type: ${natResult.natType}');
      print('  Description: ${natResult.description}');
      print('  Supports Hairpin: ${natResult.supportsHairpin}');
      
      // 获取NAT友好度评分
      final natDiscovery = stunManager.natDiscovery;
      final friendliness = natDiscovery.getNatFriendliness(natResult.natType);
      print('  Friendliness Score: $friendliness/100');
      
      await stunManager.shutdown();
      
    } catch (e) {
      print('NAT discovery example failed: $e');
    }
  }
  
  /// 高级配置示例
  static Future<void> advancedConfigExample() async {
    print('\n=== Advanced Configuration Example ===');
    
    try {
      // 高级配置
      final config = StunConfig(
        stunServers: [
          'stun.l.google.com',
          'stun1.l.google.com', 
          'stun2.l.google.com',
          'stun.services.mozilla.com',
          'stunserver.stunprotocol.org',
        ],
        stunPort: 3478,
        holePunchTimeout: 10000, // 10秒超时
        keepAliveInterval: 15000, // 15秒保持活跃
        maxRetryAttempts: 5,
        enableTunMode: true,
      );
      
      final stunManager = StunManager(config: config);
      
      // 添加自定义STUN服务器
      print('Using STUN servers: ${config.stunServers}');
      print('Configuration:');
      print('  Timeout: ${config.holePunchTimeout}ms');
      print('  Keep-alive: ${config.keepAliveInterval}ms');
      print('  Max retries: ${config.maxRetryAttempts}');
      print('  TUN mode: ${config.enableTunMode}');
      
      await stunManager.initialize();
      
      // 获取连接状态
      final status = stunManager.getConnectionStatus();
      print('Connection Status: $status');
      
      await stunManager.shutdown();
      
    } catch (e) {
      print('Advanced config example failed: $e');
    }
  }
  
  /// 错误处理示例
  static Future<void> errorHandlingExample() async {
    print('\n=== Error Handling Example ===');
    
    try {
      // 使用无效的STUN服务器配置
      final config = StunConfig(
        stunServers: ['invalid.stun.server'],
        holePunchTimeout: 1000, // 很短的超时
      );
      
      final stunManager = StunManager(config: config);
      
      try {
        await stunManager.initialize();
      } catch (e) {
        print('Expected initialization error: $e');
      }
      
      // 尝试连接不存在的对等节点
      try {
        final invalidPeer = StunPeerInfo(
          id: 'invalid-peer',
          address: '256.256.256.256', // 无效IP
          port: 99999, // 无效端口
          publicKey: 'invalid',
        );
        
        await stunManager.establishP2PConnection(invalidPeer);
      } catch (e) {
        print('Expected connection error: $e');
      }
      
    } catch (e) {
      print('Error handling example completed with expected errors');
    }
  }
  
  /// 运行所有示例
  static Future<void> runAllExamples() async {
    print('=== Running All STUN/TUN Examples ===\n');
    
    await basicStunExample();
    await p2pConnectionExample();
    await natDiscoveryExample();
    await advancedConfigExample();
    await errorHandlingExample();
    
    print('\n=== All Examples Completed ===');
  }
}