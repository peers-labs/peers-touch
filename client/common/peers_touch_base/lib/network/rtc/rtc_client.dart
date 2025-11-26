import 'dart:async';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'rtc_signaling.dart';

class RTCClient {
  final RTCSignalingService signaling;
  final String role; // 'mobile' or 'desktop'
  final String peerId; // self peer id for identification

  RTCPeerConnection? _pc;
  RTCDataChannel? _dc;

  RTCClient(this.signaling, {required this.role, required this.peerId});

  Future<void> init() async {
    final config = {'iceServers': [{'urls': ['stun:stun.l.google.com:19302']}]};
    _pc = await createPeerConnection(config);
    _pc!.onIceCandidate = (c) async {
      if (c.candidate != null) {
        await signaling.postCandidate(peerId, c.candidate!);
      }
    };
    _pc!.onDataChannel = (chan) { _dc = chan; };
  }

  Future<void> createChannel() async {
    _dc = await _pc!.createDataChannel('chat', RTCDataChannelInit());
  }

  Stream<String> messages() {
    final controller = StreamController<String>();
    _dc?.onMessage = (msg){ controller.add(msg.text); };
    return controller.stream;
  }

  Future<void> send(String text) async { await _dc?.send(RTCDataChannelMessage(text)); }

  Future<void> call(String remotePeerId) async {
    await _pc!.setLocalDescription(await _pc!.createOffer());
    await signaling.postOffer('$peerId-$remotePeerId', _pc!.getConfiguration['sdp']!);
    // wait for answer
    String? ans;
    for (var i=0;i<60 && ans==null;i++){
      await Future.delayed(const Duration(seconds:1));
      ans = await signaling.getAnswer('$peerId-$remotePeerId');
    }
    if (ans!=null){
      await _pc!.setRemoteDescription(RTCSessionDescription(ans, 'answer'));
    }
    // apply candidates
    final cands = await signaling.getCandidates('$peerId-$remotePeerId');
    for (final c in cands){ await _pc!.addCandidate(RTCIceCandidate(c, '', 0)); }
  }

  Future<void> answer(String remotePeerId) async {
    String? offer;
    for (var i=0;i<60 && offer==null;i++){
      await Future.delayed(const Duration(seconds:1));
      offer = await signaling.getOffer('$remotePeerId-$peerId');
    }
    if (offer==null) return;
    await _pc!.setRemoteDescription(RTCSessionDescription(offer, 'offer'));
    await _pc!.setLocalDescription(await _pc!.createAnswer());
    await signaling.postAnswer('$remotePeerId-$peerId',  _pc!.getConfiguration['sdp']!);
    final cands = await signaling.getCandidates('$remotePeerId-$peerId');
    for (final c in cands){ await _pc!.addCandidate(RTCIceCandidate(c, '', 0)); }
  }
}

