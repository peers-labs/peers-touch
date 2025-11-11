/// Exception types for Peers-touch client

library exceptions;

/// Base exception for all Peers-touch client errors
abstract class PeersTouchException implements Exception {
  final String message;
  final Object? cause;

  const PeersTouchException(this.message, [this.cause]);

  @override
  String toString() {
    if (cause != null) {
      return '$runtimeType: $message (caused by: $cause)';
    }
    return '$runtimeType: $message';
  }
}

/// Network-related exceptions
class NetworkException extends PeersTouchException {
  const NetworkException(super.message, [super.cause]);
}

class ConnectionException extends NetworkException {
  const ConnectionException(super.message, [super.cause]);
}

class TimeoutException extends NetworkException {
  const TimeoutException(super.message, [super.cause]);
}

/// Protocol-related exceptions
class ProtocolException extends PeersTouchException {
  const ProtocolException(super.message, [super.cause]);
}

class InvalidMessageException extends ProtocolException {
  const InvalidMessageException(super.message, [super.cause]);
}

class UnsupportedProtocolException extends ProtocolException {
  const UnsupportedProtocolException(super.message, [super.cause]);
}

/// Authentication and security exceptions
class SecurityException extends PeersTouchException {
  const SecurityException(super.message, [super.cause]);
}

class AuthenticationException extends SecurityException {
  const AuthenticationException(super.message, [super.cause]);
}

class AuthorizationException extends SecurityException {
  const AuthorizationException(super.message, [super.cause]);
}

/// Configuration exceptions
class ConfigurationException extends PeersTouchException {
  const ConfigurationException(super.message, [super.cause]);
}

/// Storage exceptions
class StorageException extends PeersTouchException {
  const StorageException(super.message, [super.cause]);
}

/// Peer discovery exceptions
class DiscoveryException extends PeersTouchException {
  const DiscoveryException(super.message, [super.cause]);
}

/// Session management exceptions
class SessionException extends PeersTouchException {
  const SessionException(super.message, [super.cause]);
}