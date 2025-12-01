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
  List<String> _iceServerUrls = [];
  final List<Map<String, String>> _localCandidates = [];
  final List<Map<String, String>> _remoteCandidates = [];
  RTCIceConnectionState? _iceConnState;
  RTCSignalingState? _signalingState;
  RTCIceGatheringState? _iceGatheringState;
  String? _localDescType;
  String? _remoteDescType;

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
    // Cache ICE server urls for later reporting
    try {
      final srv = (config['iceServers'] as List?) ?? [];
      _iceServerUrls = srv
          .expand((e) => (e is Map && e['urls'] is List) ? (e['urls'] as List).map((u) => u.toString()) : <String>[])
          .toList();
    } catch (_) {}
    _pc!.onConnectionState = (state) {
      _connectionStateController.add(state);
      print('[RTCClient][$peerId] connectionState=$state');
    };
    _pc!.onIceConnectionState = (state) {
      _iceConnState = state;
      print('[RTCClient][$peerId] iceConnectionState=$state');
    };
    _pc!.onSignalingState = (state) {
      _signalingState = state;
      print('[RTCClient][$peerId] signalingState=$state');
    };
    _pc!.onIceGatheringState = (state) {
      _iceGatheringState = state;
      print('[RTCClient][$peerId] iceGatheringState=$state');
    };
    
    _pc!.onIceCandidate = (c) async {
      if (c.candidate != null) {
        await signaling.postCandidate(sessionId, c.candidate!, mid: c.sdpMid, mline: c.sdpMLineIndex ?? 0, from: peerId);
        final parsed = _parseCandidate(c.candidate!);
        if (parsed.isNotEmpty) _localCandidates.add(parsed);
        if (parsed.isNotEmpty) {
          print('[RTCClient][$peerId] localCandidate typ=${parsed['type']} ${parsed['ip']}:${parsed['port']}');
        }
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
       print('[RTCClient][$peerId] recv=${msg.text}');
    };
    _dc!.onDataChannelState = (state) {
      _dataChannelStateController.add(state);
      print('[RTCClient][$peerId] dataChannelState=$state');
    };
  }

  Future<void> createChannel() async {
    if (_pc == null) return;
    _dc = await _pc!.createDataChannel('chat', RTCDataChannelInit());
    _setupDataChannel();
    print('[RTCClient][$peerId] dataChannel created');
  }

  final _msgController = StreamController<String>.broadcast();
  Stream<String> messages() => _msgController.stream;
  final _connectionStateController = StreamController<RTCPeerConnectionState>.broadcast();
  Stream<RTCPeerConnectionState> get onConnectionState => _connectionStateController.stream;
  final _dataChannelStateController = StreamController<RTCDataChannelState>.broadcast();
  Stream<RTCDataChannelState> get onDataChannelState => _dataChannelStateController.stream;

  Future<void> send(String text) async {
    if (_dc != null) {
      await _dc!.send(RTCDataChannelMessage(text));
    }
  }
  Future<RTCPeerConnectionState?> getConnectionState() async {
    return _pc?.getConnectionState();
  }
  RTCDataChannelState? getDataChannelState() {
    return _dc?.state;
  }

  Future<void> call(String remotePeerId) async {
    final sessionId = '$peerId-$remotePeerId';
    await _createPC(sessionId);
    await createChannel(); // Caller must create channel
    
    final offer = await _pc!.createOffer();
    await _pc!.setLocalDescription(offer);
    _localDescType = offer.type;
    
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
      _remoteDescType = 'answer';
      print('[RTCClient][$peerId] remoteDescription=answer');
    }
    
    // apply candidates
    // Give some time for candidates to gather
    await Future.delayed(const Duration(seconds: 2));
    final cands = await signaling.getCandidates(sessionId, excludeFrom: peerId);
    for (final c in cands){
      if (c is Map) {
        final cand = c['candidate']?.toString() ?? '';
        final mid = c['mid']?.toString() ?? '';
        final mline = int.tryParse((c['mline'] ?? '0').toString()) ?? 0;
        if (cand.isNotEmpty) {
          await _pc!.addCandidate(RTCIceCandidate(cand, mid, mline));
          final parsed = _parseCandidate(cand);
          if (parsed.isNotEmpty) _remoteCandidates.add(parsed);
          if (parsed.isNotEmpty) {
            print('[RTCClient][$peerId] remoteCandidate typ=${parsed['type']} ${parsed['ip']}:${parsed['port']}');
          }
        }
      } else if (c is String) {
        await _pc!.addCandidate(RTCIceCandidate(c, '', 0));
        final parsed = _parseCandidate(c);
        if (parsed.isNotEmpty) _remoteCandidates.add(parsed);
        if (parsed.isNotEmpty) {
          print('[RTCClient][$peerId] remoteCandidate typ=${parsed['type']} ${parsed['ip']}:${parsed['port']}');
        }
      }
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
    _remoteDescType = 'offer';
    _localDescType = answer.type;
    print('[RTCClient][$peerId] localDescription=answer');
    
    // Fix: Use answer.sdp
    await signaling.postAnswer(sessionId,  answer.sdp!);
    
    // apply candidates
    await Future.delayed(const Duration(seconds: 2));
    final cands = await signaling.getCandidates(sessionId, excludeFrom: peerId);
    for (final c in cands){
      if (c is Map) {
        final cand = c['candidate']?.toString() ?? '';
        final mid = c['mid']?.toString() ?? '';
        final mline = int.tryParse((c['mline'] ?? '0').toString()) ?? 0;
        if (cand.isNotEmpty) {
          await _pc!.addCandidate(RTCIceCandidate(cand, mid, mline));
          final parsed = _parseCandidate(cand);
          if (parsed.isNotEmpty) _remoteCandidates.add(parsed);
          if (parsed.isNotEmpty) {
            print('[RTCClient][$peerId] remoteCandidate typ=${parsed['type']} ${parsed['ip']}:${parsed['port']}');
          }
        }
      } else if (c is String) {
        await _pc!.addCandidate(RTCIceCandidate(c, '', 0));
        final parsed = _parseCandidate(c);
        if (parsed.isNotEmpty) _remoteCandidates.add(parsed);
        if (parsed.isNotEmpty) {
          print('[RTCClient][$peerId] remoteCandidate typ=${parsed['type']} ${parsed['ip']}:${parsed['port']}');
        }
      }
    }
  }

  Map<String, dynamic> getIceInfo() {
    int lh=0, ls=0, lr=0;
    for (final c in _localCandidates) {
      final t = c['type'];
      if (t == 'host') lh++; else if (t == 'srflx') ls++; else if (t == 'relay') lr++;
    }
    int rh=0, rs=0, rr=0;
    for (final c in _remoteCandidates) {
      final t = c['type'];
      if (t == 'host') rh++; else if (t == 'srflx') rs++; else if (t == 'relay') rr++;
    }
    return {
      'iceServers': _iceServerUrls,
      'localCandidates': _localCandidates,
      'remoteCandidates': _remoteCandidates,
      'localCounts': {'host': lh, 'srflx': ls, 'relay': lr},
      'remoteCounts': {'host': rh, 'srflx': rs, 'relay': rr},
      'localSdp': _localDescType,
      'remoteSdp': _remoteDescType,
      'iceConnState': _iceConnState?.toString(),
      'signalingState': _signalingState?.toString(),
      'iceGatheringState': _iceGatheringState?.toString(),
    };
  }

  Map<String, String> _parseCandidate(String s){
    try {
      final parts = s.split(' ');
      final ip = parts.length > 4 ? parts[4] : '';
      final port = parts.length > 5 ? parts[5] : '';
      String type = '';
      String raddr = '';
      String rport = '';
      for (var i=0;i<parts.length;i++){
        if (parts[i] == 'typ' && i+1 < parts.length) type = parts[i+1];
        if (parts[i] == 'raddr' && i+1 < parts.length) raddr = parts[i+1];
        if (parts[i] == 'rport' && i+1 < parts.length) rport = parts[i+1];
      }
      return {'ip': ip, 'port': port, 'type': type, 'raddr': raddr, 'rport': rport};
    } catch (_) {
      return {};
    }
  }
}
