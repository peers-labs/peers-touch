/// STUN/TUN穿透相关异常
library;

/// 基础STUN异常
class StunException implements Exception {
  
  const StunException(this.message, [this.cause]);
  final String message;
  final dynamic cause;
  
  @override
  String toString() => 'StunException: $message${cause != null ? ' (caused by: $cause)' : ''}';
}

/// STUN客户端异常
class StunClientException extends StunException {
  const StunClientException(super.message, [super.cause]);
}

/// TUN管理器异常
class TunManagerException extends StunException {
  const TunManagerException(super.message, [super.cause]);
}

/// 打洞异常
class HolePunchingException extends StunException {
  
  const HolePunchingException(
    String message, 
    this.peerId, 
    this.attemptCount, [
    dynamic cause,
  ]) : super(message, cause);
  final String peerId;
  final int attemptCount;
  
  @override
  String toString() => 
      'HolePunchingException: $message (peer: $peerId, attempts: $attemptCount)${cause != null ? ' (caused by: $cause)' : ''}';
}

/// NAT发现异常
class NatDiscoveryException extends StunException {
  const NatDiscoveryException(super.message, [super.cause]);
}

/// 连接异常
class P2PConnectionException extends StunException {
  
  const P2PConnectionException(
    String message,
    this.peerId, [
    this.remoteAddress,
    this.remotePort,
    dynamic cause,
  ]) : super(message, cause);
  final String peerId;
  final String? remoteAddress;
  final int? remotePort;
  
  @override
  String toString() => 
      'P2PConnectionException: $message (peer: $peerId${remoteAddress != null ? ', remote: $remoteAddress:$remotePort' : ''})${cause != null ? ' (caused by: $cause)' : ''}';
}

/// 超时异常
class StunTimeoutException extends StunException {
  
  const StunTimeoutException(
    this.operation,
    this.timeout, [
    dynamic cause,
  ]) : super('Operation timed out: $operation', cause);
  final Duration timeout;
  final String operation;
  
  @override
  String toString() => 
      'StunTimeoutException: $operation timed out after ${timeout.inMilliseconds}ms${cause != null ? ' (caused by: $cause)' : ''}';
}

/// 配置异常
class StunConfigException extends StunException {
  const StunConfigException(super.message, [super.cause]);
}