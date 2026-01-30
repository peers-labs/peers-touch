import 'dart:async';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/network/ice/ice_service.dart';
import 'package:peers_touch_base/network/rtc/rtc_signaling.dart';

typedef PeerConnectionFactory = Future<RTCPeerConnection> Function(Map<String, dynamic> configuration, [Map<String, dynamic> constraints]);

class RTCClient {

  RTCClient(
    this.signaling, {
    required this.role,
    required this.peerId,
    this.iceService,
    PeerConnectionFactory? pcFactory,
  }) : _pcFactory = pcFactory ?? createPeerConnection;
  
  final RTCSignalingService signaling;
  final String role;
  final String peerId;
  final IceService? iceService;
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

  Future<void> init() async {
  }

  Future<List<Map<String, dynamic>>> _getIceServers() async {
    if (iceService != null) {
      try {
        final servers = await iceService!.getICEServers();
        return servers.map((s) => s.toRTCIceServer()).toList();
      } catch (_) {}
    }
    return _defaultIceServers();
  }

  List<Map<String, dynamic>> _defaultIceServers() {
    return [
      {'urls': ['stun:stun.l.google.com:19302']},
      {'urls': ['stun:stun.qq.com:3478']},
      {'urls': ['stun:stun.miwifi.com:3478']},
      {'urls': ['stun:stun.xten.com']},
    ];
  }

  Future<void> _createPC(String sessionId) async {
    final iceServers = await _getIceServers();
    final config = {
      'iceServers': iceServers,
    };
    _pc = await _pcFactory(config);
    try {
      _iceServerUrls = iceServers
          .expand((e) => (e is Map && e['urls'] is List) ? (e['urls'] as List).map((u) => u.toString()) : <String>[])
          .toList();
    } catch (_) {}
    LoggingService.debug('[RTCClient][$peerId] using ICE servers: $_iceServerUrls');
    _pc!.onConnectionState = (state) {
      _connectionStateController.add(state);
      LoggingService.debug('[RTCClient][$peerId] connectionState=$state');
    };
    _pc!.onIceConnectionState = (state) {
      _iceConnState = state;
      LoggingService.debug('[RTCClient][$peerId] iceConnectionState=$state');
    };
    _pc!.onSignalingState = (state) {
      _signalingState = state;
      LoggingService.debug('[RTCClient][$peerId] signalingState=$state');
    };
    _pc!.onIceGatheringState = (state) {
      _iceGatheringState = state;
      LoggingService.debug('[RTCClient][$peerId] iceGatheringState=$state');
    };
    
    _pc!.onIceCandidate = (c) async {
      if (c.candidate != null) {
        await signaling.postCandidate(sessionId, c.candidate!, mid: c.sdpMid, mline: c.sdpMLineIndex ?? 0, from: peerId);
        final parsed = _parseCandidate(c.candidate!);
        if (parsed.isNotEmpty) _localCandidates.add(parsed);
        if (parsed.isNotEmpty) {
          LoggingService.debug('[RTCClient][$peerId] localCandidate typ=${parsed['type']} ${parsed['ip']}:${parsed['port']}');
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
       LoggingService.debug('[RTCClient][$peerId] recv=${msg.text}');
    };
    _dc!.onDataChannelState = (state) {
      _dataChannelStateController.add(state);
      LoggingService.debug('[RTCClient][$peerId] dataChannelState=$state');
    };
  }

  Future<void> createChannel() async {
    if (_pc == null) return;
    _dc = await _pc!.createDataChannel('chat', RTCDataChannelInit());
    _setupDataChannel();
    LoggingService.debug('[RTCClient][$peerId] dataChannel created');
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

  /// Generate a canonical session ID that is the same regardless of who initiates
  String _canonicalSessionId(String remotePeerId) {
    final ids = [peerId, remotePeerId]..sort();
    return '${ids[0]}-${ids[1]}';
  }

  /// Determine if this peer should be the initiator based on ID comparison
  bool _isInitiator(String remotePeerId) {
    return peerId.compareTo(remotePeerId) < 0;
  }

  /// Main connection method - handles both initiator and responder roles automatically
  /// Uses a hybrid approach: both peers try to establish connection regardless of role
  Future<void> connect(String remotePeerId) async {
    final sessionId = _canonicalSessionId(remotePeerId);
    final isInitiator = _isInitiator(remotePeerId);
    
    LoggingService.debug('[RTCClient][$peerId] connecting to $remotePeerId, session=$sessionId, isInitiator=$isInitiator');
    
    await _createPC(sessionId);
    
    if (isInitiator) {
      // Initiator: create offer, wait for answer
      await createChannel();
      final offer = await _pc!.createOffer();
      await _pc!.setLocalDescription(offer);
      _localDescType = offer.type;
      
      await signaling.postOffer(sessionId, offer.sdp!);
      LoggingService.debug('[RTCClient][$peerId] posted offer, waiting for answer...');
      
      // Wait for answer with shorter timeout - peer should respond quickly if online
      String? ans;
      for (var i = 0; i < 15 && ans == null; i++) {
        await Future.delayed(const Duration(seconds: 1));
        ans = await signaling.getAnswer(sessionId);
      }
      
      if (ans != null) {
        await _pc!.setRemoteDescription(RTCSessionDescription(ans, 'answer'));
        _remoteDescType = 'answer';
        LoggingService.debug('[RTCClient][$peerId] got answer, connection established');
      } else {
        LoggingService.debug('[RTCClient][$peerId] no answer received, peer may be offline');
      }
    } else {
      // Responder: first check if there's already an offer waiting
      LoggingService.debug('[RTCClient][$peerId] checking for existing offer from $remotePeerId...');
      
      String? offer;
      // Quick check for existing offer (5 seconds)
      for (var i = 0; i < 5 && offer == null; i++) {
        offer = await signaling.getOffer(sessionId);
        if (offer == null) {
          await Future.delayed(const Duration(seconds: 1));
        }
      }
      
      if (offer != null) {
        // Found offer, respond as callee
        await _pc!.setRemoteDescription(RTCSessionDescription(offer, 'offer'));
        _remoteDescType = 'offer';
        
        final answer = await _pc!.createAnswer();
        await _pc!.setLocalDescription(answer);
        _localDescType = answer.type;
        
        await signaling.postAnswer(sessionId, answer.sdp!);
        LoggingService.debug('[RTCClient][$peerId] posted answer to existing offer');
      } else {
        // No offer yet - the initiator may join later
        // Wait longer for offer to appear
        LoggingService.debug('[RTCClient][$peerId] no offer yet, waiting for initiator...');
        for (var i = 0; i < 15 && offer == null; i++) {
          await Future.delayed(const Duration(seconds: 1));
          offer = await signaling.getOffer(sessionId);
        }
        
        if (offer != null) {
          await _pc!.setRemoteDescription(RTCSessionDescription(offer, 'offer'));
          _remoteDescType = 'offer';
          
          final answer = await _pc!.createAnswer();
          await _pc!.setLocalDescription(answer);
          _localDescType = answer.type;
          
          await signaling.postAnswer(sessionId, answer.sdp!);
          LoggingService.debug('[RTCClient][$peerId] posted answer');
        } else {
          LoggingService.debug('[RTCClient][$peerId] no offer received after waiting, peer may be offline');
        }
      }
    }
    
    // Apply remote candidates
    await Future.delayed(const Duration(seconds: 2));
    await _applyRemoteCandidates(sessionId);
  }

  Future<void> _applyRemoteCandidates(String sessionId) async {
    final cands = await signaling.getCandidates(sessionId, excludeFrom: peerId);
    for (final c in cands) {
      if (c is Map) {
        final cand = c['candidate']?.toString() ?? '';
        final mid = c['mid']?.toString() ?? '';
        final mline = int.tryParse((c['mline'] ?? '0').toString()) ?? 0;
        if (cand.isNotEmpty) {
          await _pc!.addCandidate(RTCIceCandidate(cand, mid, mline));
          final parsed = _parseCandidate(cand);
          if (parsed.isNotEmpty) _remoteCandidates.add(parsed);
          if (parsed.isNotEmpty) {
            LoggingService.debug('[RTCClient][$peerId] remoteCandidate typ=${parsed['type']} ${parsed['ip']}:${parsed['port']}');
          }
        }
      } else if (c is String) {
        await _pc!.addCandidate(RTCIceCandidate(c, '', 0));
        final parsed = _parseCandidate(c);
        if (parsed.isNotEmpty) _remoteCandidates.add(parsed);
        if (parsed.isNotEmpty) {
          LoggingService.debug('[RTCClient][$peerId] remoteCandidate typ=${parsed['type']} ${parsed['ip']}:${parsed['port']}');
        }
      }
    }
  }

  /// Legacy call method - now just wraps connect()
  Future<void> call(String remotePeerId) async {
    await connect(remotePeerId);
  }

  /// Legacy answer method - now just wraps connect()
  Future<void> answer(String remotePeerId) async {
    await connect(remotePeerId);
  }

  Map<String, dynamic> getIceInfo() {
    int lh=0;
    int ls=0;
    int lr=0;
    for (final c in _localCandidates) {
      final t = c['type'];
      if (t == 'host') {
        lh++;
      } else if (t == 'srflx') ls++; else if (t == 'relay') lr++;
    }
    int rh=0;
    int rs=0;
    int rr=0;
    for (final c in _remoteCandidates) {
      final t = c['type'];
      if (t == 'host') {
        rh++;
      } else if (t == 'srflx') rs++; else if (t == 'relay') rr++;
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

  Future<Map<String, String>> getActiveEndpoints() async {
    try {
      if (_pc == null) return {};
      final reports = await _pc!.getStats();
      dynamic selectedPair;
      for (var r in reports) {
        final type = (r.type ?? '').toString();
        final values = (r.values ?? const {});
        if (type == 'transport') {
          final selId = values['selectedCandidatePairId'] ?? values['selectedcandidatepairid'];
          if (selId != null) {
            for (var rr in reports) {
              if (rr.id == selId) { selectedPair = rr; break; }
            }
          }
        }
        if (type == 'candidate-pair') {
          final state = (values['state'] ?? '').toString();
          final nominated = values['nominated'] == true || values['selected'] == true;
          if (state == 'succeeded' || nominated) {
            selectedPair = r;
          }
        }
      }
      Map lv = const {};
      Map rv = const {};
      if (selectedPair != null) {
        final v = selectedPair.values ?? const {};
        final lId = v['localCandidateId'] ?? v['localcandidateid'];
        final rId = v['remoteCandidateId'] ?? v['remotecandidateid'];
        if (lId != null) {
          for (var rr in reports) { if (rr.id == lId) { lv = rr.values ?? const {}; break; } }
        }
        if (rId != null) {
          for (var rr in reports) { if (rr.id == rId) { rv = rr.values ?? const {}; break; } }
        }
      }
      String lip = (lv['address'] ?? lv['ip'] ?? '').toString();
      String lport = (lv['port'] ?? '').toString();
      String ltype = (lv['candidateType'] ?? lv['type'] ?? '').toString();
      String rip = (rv['address'] ?? rv['ip'] ?? '').toString();
      String rport = (rv['port'] ?? '').toString();
      String rtype = (rv['candidateType'] ?? rv['type'] ?? '').toString();
      if (lip.isEmpty && _localCandidates.isNotEmpty) {
        final c = _localCandidates.last; lip = c['ip'] ?? ''; lport = c['port'] ?? ''; ltype = c['type'] ?? ''; 
      }
      if (rip.isEmpty && _remoteCandidates.isNotEmpty) {
        final c = _remoteCandidates.last; rip = c['ip'] ?? ''; rport = c['port'] ?? ''; rtype = c['type'] ?? ''; 
      }
      final local = lip.isEmpty ? '' : (lport.isEmpty ? lip : '$lip:$lport');
      final remote = rip.isEmpty ? '' : (rport.isEmpty ? rip : '$rip:$rport');
      return {'local': local.isEmpty ? '-' : '$local${ltype.isEmpty ? '' : ' ($ltype)'}', 'remote': remote.isEmpty ? '-' : '$remote${rtype.isEmpty ? '' : ' ($rtype)'}'};
    } catch (_) {
      return {};
    }
  }
}
