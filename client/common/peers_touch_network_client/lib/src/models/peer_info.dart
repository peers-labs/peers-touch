import 'dart:convert';

/// Information about a peer in the network
class PeerInfo {
  /// Unique identifier of the peer
  final String peerId;

  /// List of addresses where the peer can be reached
  final List<String> addresses;

  /// Additional metadata about the peer
  final Map<String, dynamic> metadata;

  /// Last time this peer was seen
  final DateTime lastSeen;

  /// Create a new PeerInfo instance
  PeerInfo({
    required this.peerId,
    required this.addresses,
    this.metadata = const {},
    DateTime? lastSeen,
  }) : lastSeen = lastSeen ?? DateTime.now();

  /// Create from JSON
  factory PeerInfo.fromJson(Map<String, dynamic> json) {
    return PeerInfo(
      peerId: json['peerId'] as String,
      addresses: List<String>.from(json['addresses'] as List),
      metadata: Map<String, dynamic>.from(json['metadata'] as Map? ?? {}),
      lastSeen: json['lastSeen'] != null
          ? DateTime.parse(json['lastSeen'] as String)
          : null,
    );
  }

  /// Convert to JSON
  Map<String, dynamic> toJson() {
    return {
      'peerId': peerId,
      'addresses': addresses,
      'metadata': metadata,
      'lastSeen': lastSeen.toIso8601String(),
    };
  }

  /// Convert to JSON string
  String toJsonString() => jsonEncode(toJson());

  /// Get the primary address (first address in the list)
  String get primaryAddress => addresses.isNotEmpty ? addresses.first : '';

  /// Check if this peer is currently online (seen within last 5 minutes)
  bool get isOnline => DateTime.now().difference(lastSeen).inMinutes < 5;

  @override
  String toString() {
    return 'PeerInfo(peerId: $peerId, addresses: $addresses, online: $isOnline)';
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is PeerInfo && other.peerId == peerId;
  }

  @override
  int get hashCode => peerId.hashCode;
}

/// Session status enum
enum SessionStatus {
  connecting,
  connected,
  disconnected,
  error,
  closed,
}

/// Peer session information
class PeerSession {
  /// Unique session identifier
  final String sessionId;

  /// Peer identifier
  final String peerId;

  /// Remote address of the peer
  final String remoteAddress;

  /// Current session status
  final SessionStatus status;

  /// When the session was created
  final DateTime createdAt;

  /// Last activity timestamp
  final DateTime lastActive;

  /// Create a new PeerSession instance
  PeerSession({
    required this.sessionId,
    required this.peerId,
    required this.remoteAddress,
    this.status = SessionStatus.connecting,
    DateTime? createdAt,
    DateTime? lastActive,
  })  : createdAt = createdAt ?? DateTime.now(),
        lastActive = lastActive ?? DateTime.now();

  /// Create from JSON
  factory PeerSession.fromJson(Map<String, dynamic> json) {
    return PeerSession(
      sessionId: json['sessionId'] as String,
      peerId: json['peerId'] as String,
      remoteAddress: json['remoteAddress'] as String,
      status: SessionStatus.values.firstWhere(
        (e) => e.name == json['status'],
        orElse: () => SessionStatus.connecting,
      ),
      createdAt: json['createdAt'] != null
          ? DateTime.parse(json['createdAt'] as String)
          : null,
      lastActive: json['lastActive'] != null
          ? DateTime.parse(json['lastActive'] as String)
          : null,
    );
  }

  /// Convert to JSON
  Map<String, dynamic> toJson() {
    return {
      'sessionId': sessionId,
      'peerId': peerId,
      'remoteAddress': remoteAddress,
      'status': status.name,
      'createdAt': createdAt.toIso8601String(),
      'lastActive': lastActive.toIso8601String(),
    };
  }

  /// Convert to JSON string
  String toJsonString() => jsonEncode(toJson());

  /// Update last activity timestamp
  PeerSession updateActivity() {
    return PeerSession(
      sessionId: sessionId,
      peerId: peerId,
      remoteAddress: remoteAddress,
      status: status,
      createdAt: createdAt,
      lastActive: DateTime.now(),
    );
  }

  /// Update session status
  PeerSession withStatus(SessionStatus newStatus) {
    return PeerSession(
      sessionId: sessionId,
      peerId: peerId,
      remoteAddress: remoteAddress,
      status: newStatus,
      createdAt: createdAt,
      lastActive: lastActive,
    );
  }

  @override
  String toString() {
    return 'PeerSession(sessionId: $sessionId, peerId: $peerId, status: $status)';
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is PeerSession && other.sessionId == sessionId;
  }

  @override
  int get hashCode => sessionId.hashCode;
}