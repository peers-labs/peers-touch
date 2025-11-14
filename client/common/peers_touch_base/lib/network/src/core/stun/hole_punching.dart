import 'dart:async';
import 'dart:typed_data';

import 'package:peers_touch_network_client/src/core/stun/stun_config.dart';
import 'package:peers_touch_network_client/src/core/stun/stun_client.dart';
import 'package:peers_touch_network_client/src/core/stun/stun_types.dart';
import 'package:peers_touch_network_client/src/core/stun/stun_peer_info.dart';
import 'package:peers_touch_network_client/src/core/stun/tun_manager.dart';

/// NAT类型枚举
enum NatType {
  unknown,
  openInternet,      // 公网IP，无NAT
  fullCone,        // 完全锥形NAT
  restrictedCone,  // 受限锥形NAT
  portRestrictedCone, // 端口受限锥形NAT
  symmetric,       // 对称NAT
}

/// NAT发现结果
class NatDiscoveryResult {
  final NatType natType;
  final bool supportsHairpin;
  final String? description;
  
  const NatDiscoveryResult({
    required this.natType,
    this.supportsHairpin = false,
    this.description,
  });
}

/// NAT发现器
class NatDiscovery {
  final StunConfig config;
  final List<StunClient> stunClients;
  
  NatDiscovery({
    required this.config,
    List<StunClient>? stunClients,
  }) : stunClients = stunClients ?? [];

  /// 发现NAT类型
  Future<NatDiscoveryResult> discoverNatType() async {
    if (stunClients.isEmpty) {
      return const NatDiscoveryResult(
        natType: NatType.unknown,
        description: 'No STUN clients available',
      );
    }

    try {
      // 使用多个STUN服务器进行测试
      final results = <StunResponse>[];
      
      for (final client in stunClients) {
        try {
          final response = await client.getPublicAddress();
          if (response.success) {
            results.add(response);
          }
        } catch (e) {
          print('STUN client failed: $e');
        }
      }

      if (results.isEmpty) {
        return const NatDiscoveryResult(
          natType: NatType.unknown,
          description: 'All STUN requests failed',
        );
      }

      // 分析NAT类型
      return _analyzeNatType(results);
    } catch (e) {
      return NatDiscoveryResult(
        natType: NatType.unknown,
        description: 'NAT discovery error: $e',
      );
    }
  }

  /// 分析NAT类型
  NatDiscoveryResult _analyzeNatType(List<StunResponse> results) {
    if (results.length == 1) {
      // 只有一个结果，无法确定NAT类型
      return const NatDiscoveryResult(
        natType: NatType.unknown,
        description: 'Insufficient data for NAT type detection',
      );
    }

    // 检查IP地址是否相同
    final firstAddress = results.first.publicAddress;
    final allSameAddress = results.every((r) => 
      r.publicAddress?.address == firstAddress?.address);

    if (!allSameAddress) {
      // 不同的公网IP，可能是对称NAT
      return const NatDiscoveryResult(
        natType: NatType.symmetric,
        description: 'Different public addresses indicate symmetric NAT',
      );
    }

    // 检查端口变化
    final firstPort = results.first.publicPort;
    final allSamePort = results.every((r) => r.publicPort == firstPort);

    if (allSamePort) {
      // 端口不变，可能是完全锥形NAT
      return const NatDiscoveryResult(
        natType: NatType.fullCone,
        description: 'Consistent public port indicates full cone NAT',
      );
    }

    // 端口变化，但IP相同，可能是受限锥形NAT
    return const NatDiscoveryResult(
      natType: NatType.restrictedCone,
      description: 'Changing ports with same IP indicates restricted cone NAT',
    );
  }

  /// 检查是否支持回环（hairpin）
  Future<bool> checkHairpinSupport() async {
    // 这里可以实现回环测试逻辑
    // 需要两个STUN客户端互相测试
    return false;
  }

  /// 获取NAT友好度评分
  int getNatFriendliness(NatType natType) {
    switch (natType) {
      case NatType.openInternet:
        return 100;
      case NatType.fullCone:
        return 90;
      case NatType.restrictedCone:
        return 70;
      case NatType.portRestrictedCone:
        return 50;
      case NatType.symmetric:
        return 30;
      case NatType.unknown:
        return 0;
    }
  }
}

/// 打洞协调器
class HolePunchingCoordinator {
  final StunConfig config;
  final TunManager tunManager;
  final NatDiscovery natDiscovery;
  
  HolePunchingCoordinator({
    required this.config,
    required this.tunManager,
    required this.natDiscovery,
  });

  /// 协调打洞过程
  Future<bool> coordinateHolePunching(
    StunPeerInfo localPeer,
    StunPeerInfo remotePeer,
  ) async {
    try {
      // 发现本地NAT类型
      final localNatType = await natDiscovery.discoverNatType();
      print('Local NAT type: ${localNatType.natType}');

      // 如果是对称NAT，需要特殊处理
      if (localNatType.natType == NatType.symmetric) {
        return await _handleSymmetricNat(localPeer, remotePeer);
      }

      // 标准打洞流程
      return await _standardHolePunching(localPeer, remotePeer);
    } catch (e) {
      print('Hole punching coordination failed: $e');
      return false;
    }
  }

  /// 处理对称NAT打洞
  Future<bool> _handleSymmetricNat(
    StunPeerInfo localPeer,
    StunPeerInfo remotePeer,
  ) async {
    // 对称NAT打洞需要更复杂的协调
    // 这里可以实现端口预测等高级技术
    print('Handling symmetric NAT hole punching');
    
    // 尝试多个端口
    for (int portOffset = 0; portOffset < 10; portOffset++) {
      try {
        final success = await _attemptHolePunchingWithPort(
          localPeer,
          remotePeer,
          remotePeer.port + portOffset,
        );
        if (success) return true;
      } catch (e) {
        print('Port $portOffset failed: $e');
      }
    }
    
    return false;
  }

  /// 标准打洞流程
  Future<bool> _standardHolePunching(
    StunPeerInfo localPeer,
    StunPeerInfo remotePeer,
  ) async {
    try {
      // 建立连接
      final connection = await tunManager.establishConnection(remotePeer);
      
      // 发送测试数据
      final testData = Uint8List.fromList([
        0xDE, 0xAD, 0xBE, 0xEF, // 魔术数字
        0x00, 0x00, 0x00, 0x01, // 版本和标志
      ]);
      
      await connection.send(testData);
      
      // 等待响应
      final response = await connection.packets.first.timeout(
        const Duration(seconds: 5),
      );
      
      // 验证响应
      if (response.length >= 4 && 
          response[0] == 0xDE && response[1] == 0xAD && 
          response[2] == 0xBE && response[3] == 0xEF) {
        print('Hole punching successful');
        return true;
      }
      
      return false;
    } catch (e) {
      print('Standard hole punching failed: $e');
      return false;
    }
  }

  /// 尝试特定端口的打洞
  Future<bool> _attemptHolePunchingWithPort(
    StunPeerInfo localPeer,
    StunPeerInfo remotePeer,
    int port,
  ) async {
    // 实现特定端口的打洞逻辑
    final modifiedPeer = StunPeerInfo(
      id: remotePeer.id,
      address: remotePeer.address,
      port: port,
      publicKey: remotePeer.publicKey,
      capabilities: remotePeer.capabilities,
    );
    
    return await _standardHolePunching(localPeer, modifiedPeer);
  }
}