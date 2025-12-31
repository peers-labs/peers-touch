import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:peers_touch_base/network/rtc/rtc_client.dart';
import 'package:peers_touch_base/network/rtc/rtc_signaling.dart';

// Mock Signaling Service
class MockSignalingService implements RTCSignalingService {
  final Map<String, String> _offers = {};
  final Map<String, String> _answers = {};
  final Map<String, List<String>> _candidates = {};

  @override
  String get baseUrl => 'mock://';

  @override
  Future<void> registerPeer(String id, String role, List<String> addrs) async {
    // print('[Signaling] Register Peer: $id');
  }

  @override
  Future<Map<String, dynamic>?> getPeer(String id) async {
    return {'id': id, 'role': 'mock'};
  }
  
  @override
  Future<Map<String, dynamic>?> getStats() async => {};
  
  @override
  Future<Map<String, dynamic>?> newSession(String a, String b) async => {};

  @override
  Future<void> postOffer(String sessionId, String sdp) async {
    print('[Signaling] Post Offer: $sessionId');
    _offers[sessionId] = sdp;
  }

  @override
  Future<String?> getOffer(String sessionId) async {
    print('[Signaling] Get Offer: $sessionId');
    return _offers[sessionId];
  }

  @override
  Future<void> postAnswer(String sessionId, String sdp) async {
    print('[Signaling] Post Answer: $sessionId');
    _answers[sessionId] = sdp;
  }

  @override
  Future<String?> getAnswer(String sessionId) async {
    print('[Signaling] Get Answer: $sessionId');
    return _answers[sessionId];
  }

  @override
  Future<void> postCandidate(String sessionId, String candidate) async {
    // print('[Signaling] Post Candidate: $sessionId');
    _candidates.putIfAbsent(sessionId, () => []).add(candidate);
  }

  @override
  Future<List<String>> getCandidates(String sessionId) async {
    return _candidates[sessionId] ?? [];
  }
  
  @override
  Future<void> _postJson(String url, Map<String, dynamic> body) async {}
  @override
  Future<Map<String, dynamic>?> _getJson(String url) async => null;
  
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class MockRTCDataChannel extends Fake implements RTCDataChannel {

  MockRTCDataChannel(this.label);
  Function(RTCDataChannelMessage message)? _onMessage;
  MockRTCDataChannel? linkedChannel;
  @override
  final String label;
  Function(RTCDataChannelState state)? _onState;

  @override
  set onMessage(Function(RTCDataChannelMessage message)? callback) {
    _onMessage = callback;
  }

  @override
  set onDataChannelState(Function(RTCDataChannelState state)? callback) {
    _onState = callback;
  }

  @override
  Future<void> send(RTCDataChannelMessage message) async {
    if (linkedChannel != null && linkedChannel!._onMessage != null) {
      linkedChannel!._onMessage!(message);
    }
  }
}

class MockRTCPeerConnection extends Fake implements RTCPeerConnection {

  MockRTCPeerConnection({this.dataChannelToCreate, this.dataChannelToReceive});
  final MockRTCDataChannel? dataChannelToCreate; // For A
  final MockRTCDataChannel? dataChannelToReceive; // For B
  
  Function(RTCDataChannel channel)? _onDataChannel;
  Function(RTCIceCandidate candidate)? _onIceCandidate;
  Function(RTCPeerConnectionState state)? _onConnectionState;

  @override
  set onDataChannel(Function(RTCDataChannel channel)? callback) {
    _onDataChannel = callback;
  }

  @override
  set onIceCandidate(Function(RTCIceCandidate candidate)? callback) {
    _onIceCandidate = callback;
  }

  @override
  set onConnectionState(Function(RTCPeerConnectionState state)? callback) {
    _onConnectionState = callback;
  }

  @override
  Future<RTCDataChannel> createDataChannel(String label, RTCDataChannelInit init) async {
    if (dataChannelToCreate != null) {
      return dataChannelToCreate!;
    }
    throw UnimplementedError();
  }

  @override
  Future<RTCSessionDescription> createOffer([Map<String, dynamic>? constraints]) async {
    return RTCSessionDescription('dummy_offer_sdp', 'offer');
  }

  @override
  Future<RTCSessionDescription> createAnswer([Map<String, dynamic>? constraints]) async {
    return RTCSessionDescription('dummy_answer_sdp', 'answer');
  }

  @override
  Future<void> setLocalDescription(RTCSessionDescription description) async {}

  @override
  Future<void> setRemoteDescription(RTCSessionDescription description) async {
    // If we are B (have dataChannelToReceive) and we receive an offer, simulate data channel open
    // In real WebRTC, this happens after answer is sent and connection established.
    // For simplicity, we trigger it here if we are the receiving side.
    if (dataChannelToReceive != null && _onDataChannel != null) {
       Future.delayed(const Duration(milliseconds: 50), () {
         _onDataChannel!(dataChannelToReceive!);
       });
    }
  }

  @override
  Future<void> addCandidate(RTCIceCandidate candidate) async {}
  
  @override
  Future<void> close() async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  
  test('RTCClient Message Exchange Test', () async {
    final signaling = MockSignalingService();
    
    // Setup Mocks
    final dcA = MockRTCDataChannel('chat');
    final dcB = MockRTCDataChannel('chat');
    dcA.linkedChannel = dcB;
    dcB.linkedChannel = dcA;

    final pcA = MockRTCPeerConnection(dataChannelToCreate: dcA);
    final pcB = MockRTCPeerConnection(dataChannelToReceive: dcB);

    final clientA = RTCClient(signaling, role: 'desktop', peerId: 'A', pcFactory: (config, [constraints = const {}]) async => pcA);
    final clientB = RTCClient(signaling, role: 'mobile', peerId: 'B', pcFactory: (config, [constraints = const {}]) async => pcB);

    // Init
    await clientA.init();
    await clientB.init();

    // Setup message listeners
    final messagesA = <String>[];
    final messagesB = <String>[];
    
    clientA.messages().listen((msg) {
      print('[A] Received: $msg');
      messagesA.add(msg);
    });
    
    clientB.messages().listen((msg) {
      print('[B] Received: $msg');
      messagesB.add(msg);
    });

    // Start connection
    print('Starting connection...');
    final futureA = clientA.call('B');
    final futureB = clientB.answer('A');
    
    await Future.wait([futureA, futureB]);
    print('Connection established (mocked)');

    // Send A -> B
    print('Sending A -> B');
    await clientA.send('Hello from A');
    
    // Give a bit of time for transmission
    await Future.delayed(const Duration(milliseconds: 100));
    
    // Send B -> A
    print('Sending B -> A');
    await clientB.send('Hello from B');
    
    await Future.delayed(const Duration(milliseconds: 100));

    print('Checking assertions...');
    print('Messages A: $messagesA');
    print('Messages B: $messagesB');

    expect(messagesB, contains('Hello from A'));
    expect(messagesA, contains('Hello from B'));
    print('Test Finished Successfully');
  });
}
