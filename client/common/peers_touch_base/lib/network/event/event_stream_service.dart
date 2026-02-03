import 'dart:async';
import 'dart:convert';
import 'package:get/get.dart';
import 'package:http/http.dart' as http;
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';

/// Event types from the backend (matching station/frame/core/event/types.go)
class EventType {
  static const String chatMessageAppended = 'chat.message.appended';
  static const String chatMessageDelivered = 'chat.message.delivered';
  static const String chatMessageRead = 'chat.message.read';
  static const String followRequested = 'follow.requested';
  static const String followAccepted = 'follow.accepted';
  static const String systemAlert = 'system.alert';
}

/// Represents an event received from the SSE stream
class ServerEvent {
  final String id;
  final String type;
  final String actorId;
  final String targetId;
  final String objectId;
  final String scope;
  final int seq;
  final DateTime timestamp;
  final Map<String, dynamic> payload;

  ServerEvent({
    required this.id,
    required this.type,
    required this.actorId,
    required this.targetId,
    required this.objectId,
    required this.scope,
    required this.seq,
    required this.timestamp,
    required this.payload,
  });

  factory ServerEvent.fromJson(Map<String, dynamic> json) {
    return ServerEvent(
      id: json['eventId'] ?? '',
      type: json['type'] ?? '',
      actorId: json['actorId'] ?? '',
      targetId: json['targetId'] ?? '',
      objectId: json['objectId'] ?? '',
      scope: json['scope'] ?? '',
      seq: json['seq'] ?? 0,
      timestamp: json['ts'] != null 
          ? DateTime.parse(json['ts']) 
          : DateTime.now(),
      payload: json['payload'] is String 
          ? jsonDecode(json['payload']) 
          : (json['payload'] ?? {}),
    );
  }

  /// Get chat message payload
  ChatMessagePayload? get chatMessagePayload {
    if (!type.startsWith('chat.message')) return null;
    return ChatMessagePayload.fromJson(payload);
  }
}

/// Payload for chat message events
class ChatMessagePayload {
  final String convId;
  final String messageId;
  final String senderId;
  final String? content;
  final String? msgType;
  final int timestamp;

  ChatMessagePayload({
    required this.convId,
    required this.messageId,
    required this.senderId,
    this.content,
    this.msgType,
    required this.timestamp,
  });

  factory ChatMessagePayload.fromJson(Map<String, dynamic> json) {
    return ChatMessagePayload(
      convId: json['convId'] ?? '',
      messageId: json['msgId'] ?? '',
      senderId: json['senderId'] ?? '',
      content: json['content'],
      msgType: json['msgType'],
      timestamp: json['timestamp'] ?? 0,
    );
  }
}

/// Service for receiving real-time events via SSE
/// 
/// Usage:
/// ```dart
/// final service = EventStreamService();
/// service.connect(baseUrl, actorId, token);
/// service.events.listen((event) {
///   switch (event.type) {
///     case EventType.chatMessageAppended:
///       // Handle new message
///       break;
///   }
/// });
/// ```
class EventStreamService {
  static EventStreamService? _instance;
  static EventStreamService get instance => _instance ??= EventStreamService._();
  
  EventStreamService._();
  
  http.Client? _client;
  StreamSubscription? _subscription;
  Timer? _reconnectTimer;
  
  final _eventController = StreamController<ServerEvent>.broadcast();
  Stream<ServerEvent> get events => _eventController.stream;
  
  String? _baseUrl;
  String? _lastEventId;
  bool _isConnected = false;
  bool _shouldReconnect = true;
  int _reconnectAttempts = 0;
  static const int _maxReconnectAttempts = 10;
  static const Duration _initialReconnectDelay = Duration(seconds: 1);
  
  /// Whether the service is currently connected
  bool get isConnected => _isConnected;
  
  /// Connect to the SSE stream
  Future<void> connect(String baseUrl) async {
    _baseUrl = baseUrl;
    _shouldReconnect = true;
    _reconnectAttempts = 0;
    
    await _establishConnection();
  }
  
  /// Disconnect from the SSE stream
  void disconnect() {
    _shouldReconnect = false;
    _reconnectTimer?.cancel();
    _subscription?.cancel();
    _client?.close();
    _client = null;
    _isConnected = false;
    LoggingService.info('[EventStreamService] Disconnected');
  }
  
  /// Re-establish connection after auth token changes
  Future<void> reconnect() async {
    if (_baseUrl == null) return;
    
    disconnect();
    _shouldReconnect = true;
    await _establishConnection();
  }
  
  Future<void> _establishConnection() async {
    if (_baseUrl == null) return;
    
    // Get auth token from GlobalContext
    String? token;
    if (Get.isRegistered<GlobalContext>()) {
      final gc = Get.find<GlobalContext>();
      token = gc.currentSession?['accessToken'] as String?;
    }
    
    if (token == null) {
      LoggingService.warning('[EventStreamService] No auth token available, cannot connect');
      return;
    }
    
    final url = '$_baseUrl/events/stream';
    
    try {
      _client = http.Client();
      
      final request = http.Request('GET', Uri.parse(url));
      request.headers['Authorization'] = 'Bearer $token';
      request.headers['Accept'] = 'text/event-stream';
      request.headers['Cache-Control'] = 'no-cache';
      
      if (_lastEventId != null) {
        request.headers['Last-Event-ID'] = _lastEventId!;
      }
      
      final response = await _client!.send(request);
      
      if (response.statusCode != 200) {
        LoggingService.error('[EventStreamService] Failed to connect: ${response.statusCode}');
        _scheduleReconnect();
        return;
      }
      
      _isConnected = true;
      _reconnectAttempts = 0;
      LoggingService.info('[EventStreamService] Connected to SSE stream');
      
      // Parse SSE stream
      _subscription = response.stream
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(
            _handleSSELine,
            onError: (error) {
              LoggingService.error('[EventStreamService] Stream error: $error');
              _handleDisconnect();
            },
            onDone: () {
              LoggingService.info('[EventStreamService] Stream closed');
              _handleDisconnect();
            },
            cancelOnError: false,
          );
          
    } catch (e) {
      LoggingService.error('[EventStreamService] Connection error: $e');
      _scheduleReconnect();
    }
  }
  
  String? _currentEventId;
  String? _currentEventType;
  StringBuffer _currentData = StringBuffer();
  
  void _handleSSELine(String line) {
    if (line.isEmpty) {
      // Empty line signals end of event
      _dispatchCurrentEvent();
      return;
    }
    
    if (line.startsWith(':')) {
      // Comment (heartbeat), ignore
      return;
    }
    
    if (line.startsWith('id:')) {
      _currentEventId = line.substring(3).trim();
      _lastEventId = _currentEventId;
    } else if (line.startsWith('event:')) {
      _currentEventType = line.substring(6).trim();
    } else if (line.startsWith('data:')) {
      if (_currentData.isNotEmpty) {
        _currentData.write('\n');
      }
      _currentData.write(line.substring(5).trim());
    }
  }
  
  void _dispatchCurrentEvent() {
    if (_currentData.isEmpty) {
      _resetEventBuffer();
      return;
    }
    
    try {
      final jsonData = jsonDecode(_currentData.toString());
      final event = ServerEvent.fromJson(jsonData);
      _eventController.add(event);
      
      LoggingService.debug('[EventStreamService] Received event: ${event.type} (${event.id})');
    } catch (e) {
      LoggingService.warning('[EventStreamService] Failed to parse event: $e');
    }
    
    _resetEventBuffer();
  }
  
  void _resetEventBuffer() {
    _currentEventId = null;
    _currentEventType = null;
    _currentData = StringBuffer();
  }
  
  void _handleDisconnect() {
    _isConnected = false;
    _subscription?.cancel();
    _client?.close();
    _client = null;
    
    if (_shouldReconnect) {
      _scheduleReconnect();
    }
  }
  
  void _scheduleReconnect() {
    if (!_shouldReconnect) return;
    
    _reconnectAttempts++;
    if (_reconnectAttempts > _maxReconnectAttempts) {
      LoggingService.error('[EventStreamService] Max reconnect attempts reached');
      return;
    }
    
    // Exponential backoff
    final delay = Duration(
      milliseconds: _initialReconnectDelay.inMilliseconds * (1 << (_reconnectAttempts - 1)),
    );
    final cappedDelay = delay > const Duration(seconds: 30) 
        ? const Duration(seconds: 30) 
        : delay;
    
    LoggingService.info('[EventStreamService] Reconnecting in ${cappedDelay.inSeconds}s (attempt $_reconnectAttempts)');
    
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(cappedDelay, _establishConnection);
  }
  
  /// Dispose the service
  void dispose() {
    disconnect();
    _eventController.close();
  }
}
