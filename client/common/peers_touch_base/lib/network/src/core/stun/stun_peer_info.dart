/// 简化的对等节点信息模型
/// 用于STUN/TUN穿透功能
class StunPeerInfo {
  /// 节点ID
  final String id;
  
  /// 节点地址（IP地址）
  final String address;
  
  /// 节点端口
  final int port;
  
  /// 公钥（可选）
  final String? publicKey;
  
  /// 节点能力列表
  final List<String> capabilities;
  
  /// 额外元数据
  final Map<String, dynamic> metadata;
  
  const StunPeerInfo({
    required this.id,
    required this.address,
    required this.port,
    this.publicKey,
    this.capabilities = const [],
    this.metadata = const {},
  });
  
  /// 从JSON创建
  factory StunPeerInfo.fromJson(Map<String, dynamic> json) {
    return StunPeerInfo(
      id: json['id'] as String,
      address: json['address'] as String,
      port: json['port'] as int,
      publicKey: json['publicKey'] as String?,
      capabilities: List<String>.from(json['capabilities'] ?? []),
      metadata: Map<String, dynamic>.from(json['metadata'] ?? {}),
    );
  }
  
  /// 转换为JSON
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'address': address,
      'port': port,
      'publicKey': publicKey,
      'capabilities': capabilities,
      'metadata': metadata,
    };
  }
  
  /// 复制并更新
  StunPeerInfo copyWith({
    String? id,
    String? address,
    int? port,
    String? publicKey,
    List<String>? capabilities,
    Map<String, dynamic>? metadata,
  }) {
    return StunPeerInfo(
      id: id ?? this.id,
      address: address ?? this.address,
      port: port ?? this.port,
      publicKey: publicKey ?? this.publicKey,
      capabilities: capabilities ?? this.capabilities,
      metadata: metadata ?? this.metadata,
    );
  }
  
  @override
  String toString() {
    return 'StunPeerInfo(id: $id, address: $address:$port, capabilities: $capabilities)';
  }
  
  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is StunPeerInfo &&
        other.id == id &&
        other.address == address &&
        other.port == port;
  }
  
  @override
  int get hashCode => id.hashCode ^ address.hashCode ^ port.hashCode;
}