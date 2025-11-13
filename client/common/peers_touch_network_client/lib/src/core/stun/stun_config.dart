/// STUN/TUN穿透配置
class StunConfig {
  /// STUN服务器地址列表
  final List<String> stunServers;
  
  /// STUN服务器端口
  final int stunPort;
  
  /// TUN接口名称
  final String? tunInterfaceName;
  
  /// 打洞超时时间（毫秒）
  final int holePunchTimeout;
  
  /// NAT映射保持活跃间隔（毫秒）
  final int keepAliveInterval;
  
  /// 最大重试次数
  final int maxRetryAttempts;
  
  /// 是否启用TUN模式
  final bool enableTunMode;
  
  const StunConfig({
    this.stunServers = const [
      'stun.l.google.com',
      'stun1.l.google.com',
      'stun2.l.google.com',
      'stun3.l.google.com',
      'stun4.l.google.com',
    ],
    this.stunPort = 3478,
    this.tunInterfaceName,
    this.holePunchTimeout = 5000,
    this.keepAliveInterval = 30000,
    this.maxRetryAttempts = 3,
    this.enableTunMode = false,
  });
}