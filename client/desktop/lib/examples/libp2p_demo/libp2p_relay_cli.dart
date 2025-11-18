import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:libp2p/libp2p.dart';
import 'package:multiaddr/multiaddr.dart';
import 'package:peerid/peerid.dart';

/// Enhanced libp2p relay demo with CLI interface
class Libp2pRelayCLI {
  late Peer _localPeer;
  late Host _host;
  late StreamController<Map<String, dynamic>> _messageController;
  bool _isRunning = false;
  
  static const String protocolId = '/peers-touch/transport/1.0.0';
  
  /// Initialize the libp2p peer with enhanced configuration
  Future<void> initialize() async {
    print('🚀 Initializing libp2p peer...');
    
    _messageController = StreamController<Map<String, dynamic>>.broadcast();
    
    try {
      // Create peer with Ed25519 key pair
      _localPeer = await Peer.create(
        keyType: KeyType.Ed25519,
      );
      
      print('📍 Local peer ID: ${_localPeer.id.toString()}');
      print('🔗 Local addresses:');
      for (final addr in _localPeer.addresses) {
        print('  - $addr');
      }
      
      // Create host with comprehensive relay support
      _host = await Host.create(
        peer: _localPeer,
        options: HostOptions(
          enableRelay: true,
          enableAutoRelay: true,
          enableNATService: true,
          enableHolePunching: true,
          ping: true,
          // Add relay discovery options
          relayDiscovery: RelayDiscoveryOptions(
            enabled: true,
            staticRelays: [], // Will be populated when connecting
          ),
        ),
      );
      
      // Set up stream handler
      _host.setStreamHandler(protocolId, _handleIncomingStream);
      
      // Set up connection event handlers
      _host.onPeerConnected = (peerId) {
        print('🟢 Peer connected: ${peerId.toString()}');
      };
      
      _host.onPeerDisconnected = (peerId) {
        print('🔴 Peer disconnected: ${peerId.toString()}');
      };
      
      print('✅ Peer initialized successfully');
      
    } catch (e, stackTrace) {
      print('❌ Failed to initialize peer: $e');
      print('Stack trace: $stackTrace');
      rethrow;
    }
  }
  
  /// Connect to relay server with retry logic
  Future<bool> connectToRelay(String relayMultiaddr, {int maxRetries = 3}) async {
    print('🌐 Connecting to relay server: $relayMultiaddr');
    
    for (int attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        print('🔄 Attempt $attempt of $maxRetries');
        
        final relayAddr = Multiaddr(relayMultiaddr);
        final peerId = PeerId.fromMultiaddr(relayAddr);
        
        print('🎯 Target peer ID: ${peerId.toString()}');
        
        // Attempt connection with timeout
        final connectionFuture = _host.connect(peerId, relayAddr);
        final result = await connectionFuture.timeout(
          Duration(seconds: 30),
          onTimeout: () => throw TimeoutException('Connection timeout'),
        );
        
        print('✅ Successfully connected to relay server');
        
        // Test the connection
        await _testConnection(peerId);
        
        return true;
        
      } catch (e) {
        print('❌ Connection attempt $attempt failed: $e');
        
        if (attempt == maxRetries) {
          print('❌ All connection attempts failed');
          return false;
        }
        
        // Wait before retry
        await Future.delayed(Duration(seconds: attempt * 2));
      }
    }
    
    return false;
  }
  
  /// Test connection with ping and message exchange
  Future<void> _testConnection(PeerId peerId) async {
    print('🧪 Testing connection to ${peerId.toString()}...');
    
    try {
      // Test with ping first
      final pingResult = await _host.ping(peerId);
      print('🏓 Ping successful: ${pingResult}ms');
      
      // Test with message exchange
      final stream = await _host.newStream(peerId, protocolId);
      
      final testMessage = {
        'type': 'connection_test',
        'message': 'Hello from Dart client!',
        'timestamp': DateTime.now().toIso8601String(),
        'peer_id': _localPeer.id.toString(),
        'client': 'dart_demo',
        'version': '1.0.0',
      };
      
      await _sendMessage(stream, testMessage);
      print('📤 Test message sent');
      
      final response = await _receiveMessage(stream).timeout(
        Duration(seconds: 10),
        onTimeout: () => {'error': 'Response timeout'},
      );
      
      print('📥 Response received: $response');
      
      if (response.containsKey('error')) {
        throw Exception('Test failed: ${response['error']}');
      }
      
      await stream.close();
      print('✅ Connection test passed');
      
    } catch (e) {
      print('❌ Connection test failed: $e');
      rethrow;
    }
  }
  
  /// Handle incoming streams
  void _handleIncomingStream(Stream stream) {
    print('📨 Incoming stream from ${stream.remotePeer.toString()}');
    
    // Process in background
    unawaited(_processIncomingStream(stream));
  }
  
  /// Process incoming stream with comprehensive error handling
  Future<void> _processIncomingStream(Stream stream) async {
    final remotePeer = stream.remotePeer;
    
    try {
      print('🔍 Processing stream from ${remotePeer.toString()}');
      
      await for (final message in _readMessages(stream)) {
        print('📨 Message from ${remotePeer.toString()}: $message');
        
        // Parse and broadcast message
        try {
          final messageData = jsonDecode(message) as Map<String, dynamic>;
          _messageController.add({
            'peer_id': remotePeer.toString(),
            'message': messageData,
            'timestamp': DateTime.now().toIso8601String(),
          });
          
          // Handle different message types
          await _handleMessageType(stream, messageData);
          
        } catch (e) {
          print('❌ Failed to parse message: $e');
          
          // Send error response
          final errorResponse = {
            'type': 'error',
            'error': 'Failed to parse message',
            'original_message': message,
          };
          
          await _sendMessage(stream, errorResponse);
        }
      }
      
    } catch (e) {
      print('❌ Error processing stream from ${remotePeer.toString()}: $e');
    } finally {
      await stream.close();
      print('🔚 Stream closed for ${remotePeer.toString()}');
    }
  }
  
  /// Handle different message types
  Future<void> _handleMessageType(Stream stream, Map<String, dynamic> message) async {
    final messageType = message['type'] as String?;
    
    switch (messageType) {
      case 'connection_test':
        final response = {
          'type': 'connection_test_response',
          'message': 'Connection test successful',
          'timestamp': DateTime.now().toIso8601String(),
          'peer_id': _localPeer.id.toString(),
          'server': 'dart_demo',
        };
        await _sendMessage(stream, response);
        break;
        
      case 'message':
        final response = {
          'type': 'message_ack',
          'acknowledged': true,
          'timestamp': DateTime.now().toIso8601String(),
          'peer_id': _localPeer.id.toString(),
        };
        await _sendMessage(stream, response);
        break;
        
      case 'ping':
        final response = {
          'type': 'pong',
          'timestamp': DateTime.now().toIso8601String(),
          'peer_id': _localPeer.id.toString(),
        };
        await _sendMessage(stream, response);
        break;
        
      default:
        // Echo back unknown messages
        final response = {
          'type': 'echo',
          'original_type': messageType,
          'message': 'Echo: ${message['message'] ?? 'No message'}',
          'timestamp': DateTime.now().toIso8601String(),
          'peer_id': _localPeer.id.toString(),
        };
        await _sendMessage(stream, response);
    }
  }
  
  /// Send message with error handling
  Future<void> _sendMessage(Stream stream, Map<String, dynamic> message) async {
    try {
      final messageJson = jsonEncode(message);
      final messageBytes = Uint8List.fromList(utf8.encode(messageJson));
      
      final lengthBytes = ByteData(4)..setUint32(0, messageBytes.length);
      
      await stream.write(lengthBytes.buffer.asUint8List());
      await stream.write(messageBytes);
      
      print('📤 Sent message: ${message['type']}');
      
    } catch (e) {
      print('❌ Failed to send message: $e');
      rethrow;
    }
  }
  
  /// Receive message with timeout and error handling
  Future<Map<String, dynamic>> _receiveMessage(Stream stream) async {
    try {
      // Read length prefix
      final lengthBytes = await stream.read(4);
      final length = ByteData.sublistView(lengthBytes).getUint32(0);
      
      if (length > 1024 * 1024) { // 1MB limit
        throw Exception('Message too large: $length bytes');
      }
      
      // Read message
      final messageBytes = await stream.read(length);
      final messageJson = utf8.decode(messageBytes);
      
      return jsonDecode(messageJson) as Map<String, dynamic>;
      
    } catch (e) {
      print('❌ Failed to receive message: $e');
      rethrow;
    }
  }
  
  /// Read messages from stream
  Stream<String> _readMessages(Stream stream) async* {
    try {
      while (true) {
        final lengthBytes = await stream.read(4);
        final length = ByteData.sublistView(lengthBytes).getUint32(0);
        
        if (length > 1024 * 1024) { // 1MB limit
          throw Exception('Message too large: $length bytes');
        }
        
        final messageBytes = await stream.read(length);
        final messageJson = utf8.decode(messageBytes);
        
        yield messageJson;
      }
    } catch (e) {
      print('🔚 Stream read ended: $e');
    }
  }
  
  /// Send message to specific peer
  Future<bool> sendMessageToPeer(PeerId peerId, String content, {String type = 'message'}) async {
    try {
      final stream = await _host.newStream(peerId, protocolId);
      
      final message = {
        'type': type,
        'message': content,
        'timestamp': DateTime.now().toIso8601String(),
        'peer_id': _localPeer.id.toString(),
      };
      
      await _sendMessage(stream, message);
      
      final response = await _receiveMessage(stream);
      await stream.close();
      
      print('✅ Message sent successfully, response: ${response['type']}');
      return true;
      
    } catch (e) {
      print('❌ Failed to send message: $e');
      return false;
    }
  }
  
  /// Interactive CLI interface
  Future<void> startCLI() async {
    _isRunning = true;
    print('\n🚀 Starting libp2p relay CLI...');
    print('📍 Local peer: ${_localPeer.id.toString()}');
    print('📝 Available commands:');
    print('  connect <multiaddr>  - Connect to relay server');
    print('  send <peer_id> <message> - Send message to peer');
    print('  peers               - List connected peers');
    print('  info                - Show local peer info');
    print('  help                - Show this help');
    print('  exit                - Exit the CLI');
    print('');
    
    // Listen for incoming messages in background
    _messageController.stream.listen((messageData) {
      final peerId = messageData['peer_id'];
      final message = messageData['message'];
      print('\n📨 Message from $peerId: ${message['message'] ?? message}');
      print('> ');
    });
    
    final stdin = io.stdin;
    stdin.echoMode = false;
    stdin.lineMode = true;
    
    while (_isRunning) {
      stdout.write('> ');
      final input = stdin.readLineSync()?.trim();
      
      if (input == null || input.isEmpty) continue;
      
      await _handleCommand(input);
    }
  }
  
  /// Handle CLI commands
  Future<void> _handleCommand(String input) async {
    final parts = input.split(' ');
    final command = parts[0].toLowerCase();
    
    switch (command) {
      case 'connect':
        if (parts.length < 2) {
          print('❌ Usage: connect <multiaddr>');
          return;
        }
        final multiaddr = parts.sublist(1).join(' ');
        final success = await connectToRelay(multiaddr);
        print(success ? '✅ Connected successfully' : '❌ Connection failed');
        break;
        
      case 'send':
        if (parts.length < 3) {
          print('❌ Usage: send <peer_id> <message>');
          return;
        }
        final peerIdStr = parts[1];
        final message = parts.sublist(2).join(' ');
        
        try {
          final peerId = PeerId.fromString(peerIdStr);
          final success = await sendMessageToPeer(peerId, message);
          print(success ? '✅ Message sent' : '❌ Failed to send message');
        } catch (e) {
          print('❌ Invalid peer ID: $e');
        }
        break;
        
      case 'peers':
        final peers = connectedPeers;
        if (peers.isEmpty) {
          print('📋 No connected peers');
        } else {
          print('📋 Connected peers:');
          for (final peer in peers) {
            print('  - ${peer.toString()}');
          }
        }
        break;
        
      case 'info':
        final info = localPeerInfo;
        print('📍 Local Peer Info:');
        print('  ID: ${info['id']}');
        print('  Addresses:');
        for (final addr in info['addresses']) {
          print('    - $addr');
        }
        break;
        
      case 'help':
        print('📝 Available commands:');
        print('  connect <multiaddr>  - Connect to relay server');
        print('  send <peer_id> <message> - Send message to peer');
        print('  peers               - List connected peers');
        print('  info                - Show local peer info');
        print('  help                - Show this help');
        print('  exit                - Exit the CLI');
        break;
        
      case 'exit':
      case 'quit':
        _isRunning = false;
        print('👋 Goodbye!');
        break;
        
      default:
        print('❌ Unknown command: $command');
        print('Type "help" for available commands');
    }
  }
  
  /// Get local peer info
  Map<String, dynamic> get localPeerInfo => {
    'id': _localPeer.id.toString(),
    'addresses': _localPeer.addresses.map((a) => a.toString()).toList(),
  };
  
  /// Get connected peers
  List<PeerId> get connectedPeers => _host.connectedPeers;
  
  /// Cleanup and disconnect
  Future<void> disconnect() async {
    print('🛑 Disconnecting...');
    
    _isRunning = false;
    await _messageController.close();
    await _host.close();
    
    print('✅ Disconnected successfully');
  }
}

/// Main function with argument parsing
void main(List<String> arguments) async {
  final cli = Libp2pRelayCLI();
  
  try {
    await cli.initialize();
    
    if (arguments.isNotEmpty) {
      // Command line mode
      await _handleCommandLineMode(cli, arguments);
    } else {
      // Interactive CLI mode
      await cli.startCLI();
    }
    
  } catch (e, stackTrace) {
    print('❌ Fatal error: $e');
    print('Stack trace: $stackTrace');
    exit(1);
  } finally {
    await cli.disconnect();
  }
}

/// Handle command line mode
Future<void> _handleCommandLineMode(Lib2pRelayCLI cli, List<String> arguments) async {
  final command = arguments[0].toLowerCase();
  
  switch (command) {
    case 'connect':
      if (arguments.length < 2) {
        print('❌ Usage: dart libp2p_relay_cli.dart connect <multiaddr>');
        return;
      }
      final multiaddr = arguments.sublist(1).join(' ');
      final success = await cli.connectToRelay(multiaddr);
      exit(success ? 0 : 1);
      
    case 'info':
      final info = cli.localPeerInfo;
      print(jsonEncode(info));
      break;
      
    case 'test':
      if (arguments.length < 2) {
        print('❌ Usage: dart libp2p_relay_cli.dart test <multiaddr>');
        return;
      }
      final multiaddr = arguments.sublist(1).join(' ');
      final success = await cli.connectToRelay(multiaddr);
      
      if (success) {
        // Send test message
        final peers = cli.connectedPeers;
        if (peers.isNotEmpty) {
          await cli.sendMessageToPeer(peers.first, 'Test message from command line');
        }
      }
      
      exit(success ? 0 : 1);
      
    default:
      print('❌ Unknown command: $command');
      print('Available commands: connect, info, test');
      exit(1);
  }
}