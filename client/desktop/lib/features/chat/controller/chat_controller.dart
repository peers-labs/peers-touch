import 'package:get/get.dart';
import 'package:flutter/material.dart';
import 'dart:async';
import 'dart:io';
import 'dart:convert';
import 'package:peers_touch_base/network/rtc/rtc_client.dart';
import 'package:peers_touch_base/network/rtc/rtc_signaling.dart';

class ChatController extends GetxController {
  final messages = <String>[].obs;
  final textController = TextEditingController();
  final signalingUrl = ''.obs;
  final selfPeerId = 'desktop-1'.obs;
  final targetPeerId = 'mobile-1'.obs;
  final connectionStatus = 'Unknown'.obs;
  final dataChannelStatus = 'Unknown'.obs;
  final checkingConnection = false.obs;
  final peerRegistered = false.obs;
  final lastCheckSummary = ''.obs;
  final iceDetails = <String, dynamic>{}.obs;
  final autoAnswering = false.obs;
  final connectedPeers = <String>[].obs;
  final actors = <Map<String, dynamic>>[].obs;
  final loadingActors = false.obs;
  
  RTCClient? _client;
  RTCSignalingService? _signaling;
  Timer? _hb;
  Timer? _connMonitor;

  final debugStats = <String, dynamic>{}.obs;
  final isFetchingStats = false.obs;
  
  @override
  void onInit() {
    super.onInit();
    // Default URL for local testing if needed
    signalingUrl.value = 'http://localhost:8080';
  }

  @override
  void onClose() {
    textController.dispose();
    try {
      _signaling?.unregisterPeer(selfPeerId.value);
    } catch (_) {}
    _hb?.cancel();
    _connMonitor?.cancel();
    super.onClose();
  }
  
  Future<void> fetchDebugStats() async {
    if (signalingUrl.value.isEmpty) return;
    isFetchingStats.value = true;
    try {
      // Create a temporary signaling service if not initialized
      final service = _signaling ?? RTCSignalingService(signalingUrl.value);
      final stats = await service.getStats();
      if (stats != null) {
        debugStats.value = stats;
      } else {
        debugStats.value = {'error': 'Failed to fetch stats (Response null)'};
      }
    } catch (e) {
      debugStats.value = {'error': e.toString()};
    } finally {
      isFetchingStats.value = false;
    }
  }

  Future<void> initChat() async {
    if (signalingUrl.value.isEmpty) {
      Get.snackbar('Error', 'Please enter Signaling URL');
      return;
    }
    
    try {
      _signaling = RTCSignalingService(signalingUrl.value);
      _client = RTCClient(_signaling!, role: 'desktop', peerId: selfPeerId.value);
      await _client!.init();
      _client!.onConnectionState.listen((s) {
        final t = s.toString().split('.').last;
        connectionStatus.value = t;
      });
      _client!.onDataChannelState.listen((s) {
        final t = s.toString().split('.').last;
        dataChannelStatus.value = t;
      });
      
      // Register self
      await _signaling!.registerPeer(selfPeerId.value, 'desktop', []);
      Get.snackbar('Success', 'Registered as ${selfPeerId.value}');
      
      // Listen for messages
      _client!.messages().listen((msg) {
        messages.add("Peer: $msg");
      });
      _hb?.cancel();
      _hb = Timer.periodic(const Duration(seconds: 30), (t) async {
        try { await _signaling!.registerPeer(selfPeerId.value, 'desktop', []); } catch (_) {}
      });
      _connMonitor?.cancel();
      _connMonitor = Timer.periodic(const Duration(seconds: 1), (t) {
        final info = _client!.getIceInfo();
        final cs = info['iceConnState']?.toString() ?? 'Unknown';
        connectionStatus.value = cs.split('.').last;
        final ds = _client!.getDataChannelState();
        if (ds != null) dataChannelStatus.value = ds.toString().split('.').last;
        iceDetails.value = info;
        _client!.getActiveEndpoints().then((endpoints){
          if (endpoints.isNotEmpty) {
            final merged = Map<String, dynamic>.from(iceDetails);
            merged['activeLocal'] = endpoints['local'];
            merged['activeRemote'] = endpoints['remote'];
            iceDetails.value = merged;
          }
        });
      });
    } catch (e) {
      Get.snackbar('Error', 'Init failed: $e');
    }
  }
  
  Future<void> connect() async {
    if (_client == null) {
      Get.snackbar('Error', 'Please Init first');
      return;
    }
    try {
      await _client!.call(targetPeerId.value);
      Get.snackbar('Success', 'Calling ${targetPeerId.value}...');
    } catch (e) {
      Get.snackbar('Error', 'Call failed: $e');
    }
  }

  Future<void> answer() async {
     if (_client == null) {
      Get.snackbar('Error', 'Please Init first');
      return;
    }
    try {
      await _client!.answer(targetPeerId.value);
      Get.snackbar('Success', 'Answering ${targetPeerId.value}...');
    } catch (e) {
      Get.snackbar('Error', 'Answer failed: $e');
    }
  }
  
  Future<void> sendMessage() async {
    final text = textController.text;
    if (text.isEmpty || _client == null) return;
    try {
      await _client!.send(text);
      messages.add("Me: $text");
      textController.clear();
    } catch (e) {
      Get.snackbar('Error', 'Send failed: $e');
    }
  }

  Future<void> checkConnection() async {
    if (_client == null || _signaling == null) return;
    checkingConnection.value = true;
    try {
      final p = await _signaling!.getPeer(targetPeerId.value);
      peerRegistered.value = p != null;
      final info = _client!.getIceInfo();
      final cs = info['iceConnState']?.toString() ?? 'Unknown';
      final sig = info['signalingState']?.toString() ?? '';
      final ds = _client!.getDataChannelState();
      connectionStatus.value = cs.split('.').last;
      if (ds != null) dataChannelStatus.value = ds.toString().split('.').last;
      final sidA = '${selfPeerId.value}-${targetPeerId.value}';
      final sidB = '${targetPeerId.value}-${selfPeerId.value}';
      final offerA = await _signaling!.getOffer(sidA);
      final answerA = await _signaling!.getAnswer(sidA);
      final candA = await _signaling!.getCandidates(sidA);
      final offerB = await _signaling!.getOffer(sidB);
      final answerB = await _signaling!.getAnswer(sidB);
      final candB = await _signaling!.getCandidates(sidB);
      if (offerB != null && (connectionStatus.value == 'Unknown' || connectionStatus.value == 'new' || connectionStatus.value == 'checking')) {
        try { await _client!.answer(targetPeerId.value); } catch (_) {}
      }
      lastCheckSummary.value = 'peerRegistered=${peerRegistered.value}; pc=$connectionStatus; dc=$dataChannelStatus; ' 
        'offerA=${offerA!=null}; answerA=${answerA!=null}; candA=${candA.length}; ' 
        'offerB=${offerB!=null}; answerB=${answerB!=null}; candB=${candB.length}';

      // ICE details
      final endpoints = await _client!.getActiveEndpoints();
      info['activeLocal'] = endpoints['local'];
      info['activeRemote'] = endpoints['remote'];
      iceDetails.value = info;
    } finally {
      checkingConnection.value = false;
    }
  }

  Future<void> loadActors() async {
    final base = signalingUrl.value.trim();
    if (base.isEmpty) return;
    loadingActors.value = true;
    try {
      final uri = Uri.parse(base.endsWith('/') ? '${base}actor/list' : '$base/actor/list');
      final req = await HttpClient().getUrl(uri);
      final resp = await req.close();
      if (resp.statusCode == 200) {
        final text = await resp.transform(const Utf8Decoder()).join();
        final obj = json.decode(text);
        final data = obj is Map && obj['data'] is List ? obj['data'] as List : [];
        actors.assignAll(data.whereType<Map>().map((e) => e.map((k, v) => MapEntry(k.toString(), v))).toList());
      }
    } catch (_) {}
    loadingActors.value = false;
  }

  Future<void> fetchConnections() async {
    if (_signaling == null) return;
    try {
      final sessions = await _signaling!.getSessions(peer: selfPeerId.value);
      final set = <String>{};
      for (final s in sessions) {
        final a = s['a']?.toString();
        final b = s['b']?.toString();
        if (a == selfPeerId.value && b != null) set.add(b);
        if (b == selfPeerId.value && a != null) set.add(a);
      }
      connectedPeers.assignAll(set.toList());
    } catch (_) {}
  }

  Future<void> autoAnswer() async {
    if (_client == null || _signaling == null) return;
    autoAnswering.value = true;
    try {
      final sid = '${targetPeerId.value}-${selfPeerId.value}';
      for (var i = 0; i < 30; i++) {
        final offer = await _signaling!.getOffer(sid);
        if (offer != null) {
          await _client!.answer(targetPeerId.value);
          break;
        }
        await Future.delayed(const Duration(seconds: 1));
      }
    } finally {
      autoAnswering.value = false;
    }
  }
}
