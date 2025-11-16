import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:libp2p/libp2p.dart';
import 'package:multiaddr/multiaddr.dart';
import 'package:peerid/peerid.dart';

/// Dart demo for connecting to Go libp2p relay server
/// This demo shows how to:
/// 1. Create a libp2p peer
/// 2. Connect to the Go relay server
/// 3. Send and receive messages
/// 4. Handle peer discovery
class Libp2pRelayDemo {
  late Peer _localPeer;
  late Host _host;
  late StreamController<String> _messageController;
  
  // Protocol ID should match the Go implementation
  static const String protocolId = '/peers-touch/transport/1.0.0';
  
  /// Initialize the libp2p peer
  Future<void> initialize() async {
    print('🚀 Initializing libp2p peer...');
    
    _messageController = StreamController<String>.broadcast();
    
    // Create a new peer with Ed25519 key pair (matching Go implementation)
    _localPeer = await Peer.create(
      keyType: KeyType.Ed25519,
    );
    
    print('📍 Local peer ID: ${_localPeer.id.toString()}');
    print('🔗 Local peer addresses: ${_localPeer.addresses.map((a) => a.toString()).join(', ')}');
    
    // Create host with relay support
    _host = await Host.create(
      peer: _localPeer,
      options: HostOptions(
        enableRelay: true,
        enableAutoRelay: true,
        enableNATService: true,
        enableHolePunching: true,
        ping: true,
      ),
    );
    
    // Set up stream handler for incoming connections
    _host.setStreamHandler(protocolId, _handleIncomingStream);
    
    print('✅ Peer initialized successfully');
  }
  
  /// Connect to the Go relay server
  Future<void> connectToRelay(String relayMultiaddr) async {
    print('🌐 Connecting to relay server: $relayMultiaddr');
    
    try {
      // Parse the multiaddr
      final relayAddr = Multiaddr(relayMultiaddr);
      
      // Extract peer ID from multiaddr
      final peerId = PeerId.fromMultiaddr(relayAddr);
      
      print('🎯 Target peer ID: ${peerId.toString()}');
      
      // Connect to the relay peer
      await _host.connect(peerId, relayAddr);
      
      print('✅ Successfully connected to relay server');
      
      // Open a stream to test communication
      await _testStreamConnection(peerId);
      
    } catch (e) {
      print('❌ Failed to connect to relay server: $e');
      rethrow;
    }
  }
  
  /// Test stream connection by opening a stream and sending a test message
  Future<void> _testStreamConnection(PeerId peerId) async {
    print('🧪 Testing stream connection...');
    
    try {
      // Open a stream to the relay server
      final stream = await _host.newStream(peerId, protocolId);
      
      // Create test message
      final testMessage = {
        'type': 'test',
        'message': 'Hello from Dart client!',
        'timestamp': DateTime.now().toIso8601String(),
        'peer_id': _localPeer.id.toString(),
      };
      
      // Send the message
      await _sendMessage(stream, testMessage);
      print('📤 Test message sent successfully');
      
      // Wait for response
      final response = await _receiveMessage(stream);
      print('📥 Received response: $response');
      
      // Close the stream
      await stream.close();
      
    } catch (e) {
      print('❌ Stream test failed: $e');
      rethrow;
    }
  }
  
  /// Handle incoming streams from other peers
  void _handleIncomingStream(Stream stream) {
    print('📨 Incoming stream from ${stream.remotePeer.toString()}');
    
    // Handle the stream in a separate async function
    _processIncomingStream(stream);
  }
  
  /// Process incoming stream messages
  Future<void> _processIncomingStream(Stream stream) async {
    try {
      // Listen for messages on this stream
      await for (final message in _readMessages(stream)) {
        print('📨 Received message: $message');
        _messageController.add(message);
        
        // Echo back a response
        final response = {
          'type': 'response',
          'original_message': message,
          'echo': 'Received your message!',
          'timestamp': DateTime.now().toIso8601String(),
          'peer_id': _localPeer.id.toString(),
        };
        
        await _sendMessage(stream, response);
      }
    } catch (e) {
      print('❌ Error processing incoming stream: $e');
    } finally {
      await stream.close();
    }
  }
  
  /// Send a message through a stream
  Future<void> _sendMessage(Stream stream, Map<String, dynamic> message) async {
    final messageJson = jsonEncode(message);
    final messageBytes = Uint8List.fromList(utf8.encode(messageJson));
    
    // Send length prefix (4 bytes) + message
    final lengthBytes = ByteData(4)..setUint32(0, messageBytes.length);
    await stream.write(lengthBytes.buffer.asUint8List());
    await stream.write(messageBytes);
  }
  
  /// Receive a message from a stream
  Future<Map<String, dynamic>> _receiveMessage(Stream stream) async {
    // Read length prefix
    final lengthBytes = await stream.read(4);
    final length = ByteData.sublistView(lengthBytes).getUint32(0);
    
    // Read message
    final messageBytes = await stream.read(length);
    final messageJson = utf8.decode(messageBytes);
    
    return jsonDecode(messageJson) as Map<String, dynamic>;
  }
  
  /// Read messages from stream (async generator)
  Stream<String> _readMessages(Stream stream) async* {
    try {
      while (true) {
        // Read length prefix
        final lengthBytes = await stream.read(4);
        final length = ByteData.sublistView(lengthBytes).getUint32(0);
        
        // Read message
        final messageBytes = await stream.read(length);
        final messageJson = utf8.decode(messageBytes);
        
        yield messageJson;
      }
    } catch (e) {
      // Stream ended or error occurred
      print('🔚 Stream ended: $e');
    }
  }
  
  /// Send a message to a specific peer
  Future<void> sendMessageToPeer(PeerId peerId, String message) async {
    try {
      final stream = await _host.newStream(peerId, protocolId);
      
      final messageData = {
        'type': 'message',
        'content': message,
        'timestamp': DateTime.now().toIso8601String(),
        'peer_id': _localPeer.id.toString(),
      };
      
      await _sendMessage(stream, messageData);
      print('📤 Message sent to ${peerId.toString()}: $message');
      
      // Wait for response
      final response = await _receiveMessage(stream);
      print('📥 Response received: $response');
      
      await stream.close();
    } catch (e) {
      print('❌ Failed to send message: $e');
      rethrow;
    }
  }
  
  /// Get stream of received messages
  Stream<String> get receivedMessages => _messageController.stream;
  
  /// Get local peer info
  Map<String, dynamic> get localPeerInfo => {
    'id': _localPeer.id.toString(),
    'addresses': _localPeer.addresses.map((a) => a.toString()).toList(),
  };
  
  /// Get connected peers
  List<PeerId> get connectedPeers => _host.connectedPeers;
  
  /// Disconnect and cleanup
  Future<void> disconnect() async {
    print('🛑 Disconnecting...');
    
    await _messageController.close();
    await _host.close();
    
    print('✅ Disconnected successfully');
  }
}

/// Example usage and main function
void main() async {
  final demo = Libp2pRelayDemo();
  
  try {
    // Initialize the peer
    await demo.initialize();
    
    // Listen for incoming messages
    demo.receivedMessages.listen((message) {
      print('📝 Received message: $message');
    });
    
    // Example: Connect to a relay server
    // Replace with actual relay server multiaddr
    final relayMultiaddr = '/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWLQzUh...';
    
    print('\n🔄 To connect to a relay server, call:');
    print('await demo.connectToRelay("/ip4/127.0.0.1/tcp/4001/p2p/YOUR_RELAY_PEER_ID");');
    print('\n📋 Local peer info:');
    print(demo.localPeerInfo);
    
    // Keep the program running
    print('\n🚀 Demo is running. Press Ctrl+C to exit.');
    await Future.delayed(Duration(days: 365)); // Keep alive
    
  } catch (e) {
    print('❌ Demo failed: $e');
  } finally {
    await demo.disconnect();
  }
}