/// STUN/TUN穿透相关异常

/// 基础STUN异常
class StunException implements Exception {
  final String message;
  final dynamic cause;
  
  const StunException(this.message, [this.cause]);
  
  @override
  String toString() => 'StunException: $message${cause != null ? ' (caused by: $cause)' : ''}';
}

/// STUN客户端异常
class StunClientException extends StunException {
  const StunClientException(String message, [dynamic cause]) 
      : super(message, cause);
}

/// TUN管理器异常
class TunManagerException extends StunException {
  const TunManagerException(String message, [dynamic cause]) 
      : super(message, cause);
}

/// 打洞异常
class HolePunchingException extends StunException {
  final String peerId;
  final int attemptCount;
  
  const HolePunchingException(
    String message, 
    this.peerId, 
    this.attemptCount, [
    dynamic cause,
  ]) : super(message, cause);
  
  @override
  String toString() => 
      'HolePunchingException: $message (peer: $peerId, attempts: $attemptCount)${cause != null ? ' (caused by: $cause)' : ''}';
}

/// NAT发现异常
class NatDiscoveryException extends StunException {
  const NatDiscoveryException(String message, [dynamic cause]) 
      : super(message, cause);
}

/// 连接异常
class P2PConnectionException extends StunException {
  final String peerId;
  final String? remoteAddress;
  final int? remotePort;
  
  const P2PConnectionException(
    String message,
    this.peerId, [
    this.remoteAddress,
    this.remotePort,
    dynamic cause,
  ]) : super(message, cause);
  
  @override
  String toString() => 
      'P2PConnectionException: $message (peer: $peerId${remoteAddress != null ? ', remote: $remoteAddress:$remotePort' : ''})${cause != null ? ' (caused by: $cause)' : ''}';
}

/// 超时异常
class StunTimeoutException extends StunException {
  final Duration timeout;
  final String operation;
  
  const StunTimeoutException(
    this.operation,
    this.timeout, [
    dynamic cause,
  ]) : super('Operation timed out: $operation', cause);
  
  @override
  String toString() => 
      'StunTimeoutException: $operation timed out after ${timeout.inMilliseconds}ms${cause != null ? ' (caused by: $cause)' : ''}';
}

/// 配置异常
class StunConfigException extends StunException {
  const StunConfigException(String message, [dynamic cause]) 
      : super(message, cause);
}