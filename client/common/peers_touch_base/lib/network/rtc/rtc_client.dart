import 'dart:async';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'rtc_signaling.dart';

typedef PeerConnectionFactory = Future<RTCPeerConnection> Function(Map<String, dynamic> configuration, [Map<String, dynamic> constraints]);

class RTCClient {
  final RTCSignalingService signaling;
  final String role; // 'mobile' or 'desktop'
  final String peerId; // self peer id for identification
  final PeerConnectionFactory _pcFactory;

  RTCPeerConnection? _pc;
  RTCDataChannel? _dc;

  RTCClient(this.signaling, {required this.role, required this.peerId, PeerConnectionFactory? pcFactory})
      : _pcFactory = pcFactory ?? createPeerConnection;

  Future<void> init() async {
    // Just placeholder if needed, or maybe setup generic listeners
  }

  Future<void> _createPC(String sessionId) async {
    final config = {
      'iceServers': [
        {'urls': ['stun:stun.l.google.com:19302']},
        {'urls': ['stun:stun.qq.com:3478']},
        {'urls': ['stun:stun.miwifi.com:3478']},
        {'urls': ['stun:stun.xten.com']},
      ]
    };
    _pc = await _pcFactory(config);
    
    _pc!.onIceCandidate = (c) async {
      if (c.candidate != null) {
        // Use sessionId for candidates
        await signaling.postCandidate(sessionId, c.candidate!);
      }
    };
    
    _pc!.onDataChannel = (chan) {
      _dc = chan;
      _setupDataChannel();
    };
  }
  
  void _setupDataChannel() {
    if (_dc == null) return;
    _dc!.onMessage = (msg) {
       _msgController.add(msg.text); 
    };
  }

  Future<void> createChannel() async {
    if (_pc == null) return;
    _dc = await _pc!.createDataChannel('chat', RTCDataChannelInit());
    _setupDataChannel();
  }

  final _msgController = StreamController<String>.broadcast();
  Stream<String> messages() => _msgController.stream;

  Future<void> send(String text) async { await _dc?.send(RTCDataChannelMessage(text)); }

  Future<void> call(String remotePeerId) async {
    final sessionId = '$peerId-$remotePeerId';
    await _createPC(sessionId);
    await createChannel(); // Caller must create channel
    
    final offer = await _pc!.createOffer();
    await _pc!.setLocalDescription(offer);
    
    // Fix: Use offer.sdp, not getConfiguration
    await signaling.postOffer(sessionId, offer.sdp!);
    
    // wait for answer
    String? ans;
    for (var i=0;i<60 && ans==null;i++){
      await Future.delayed(const Duration(seconds:1));
      ans = await signaling.getAnswer(sessionId);
    }
    
    if (ans!=null){
      await _pc!.setRemoteDescription(RTCSessionDescription(ans, 'answer'));
    }
    
    // apply candidates
    // Give some time for candidates to gather
    await Future.delayed(const Duration(seconds: 2));
    final cands = await signaling.getCandidates(sessionId);
    for (final c in cands){ 
      await _pc!.addCandidate(RTCIceCandidate(c, '', 0)); 
    }
  }

  Future<void> answer(String remotePeerId) async {
    final sessionId = '$remotePeerId-$peerId';
    await _createPC(sessionId);
    
    String? offer;
    for (var i=0;i<60 && offer==null;i++){
      await Future.delayed(const Duration(seconds:1));
      offer = await signaling.getOffer(sessionId);
    }
    
    if (offer==null) return;
    
    await _pc!.setRemoteDescription(RTCSessionDescription(offer, 'offer'));
    final answer = await _pc!.createAnswer();
    await _pc!.setLocalDescription(answer);
    
    // Fix: Use answer.sdp
    await signaling.postAnswer(sessionId,  answer.sdp!);
    
    // apply candidates
    await Future.delayed(const Duration(seconds: 2));
    final cands = await signaling.getCandidates(sessionId);
    for (final c in cands){ 
      await _pc!.addCandidate(RTCIceCandidate(c, '', 0)); 
    }
  }
}

