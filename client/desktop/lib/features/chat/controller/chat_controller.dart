import 'package:get/get.dart';
import 'package:flutter/material.dart';
import 'package:peers_touch_base/network/rtc/rtc_client.dart';
import 'package:peers_touch_base/network/rtc/rtc_signaling.dart';

class ChatController extends GetxController {
  final messages = <String>[].obs;
  final textController = TextEditingController();
  final signalingUrl = ''.obs;
  final selfPeerId = 'desktop-1'.obs;
  final targetPeerId = 'mobile-1'.obs;
  
  RTCClient? _client;
  
  @override
  void onInit() {
    super.onInit();
    // Default URL for local testing if needed
    signalingUrl.value = 'http://localhost:8080';
  }

  @override
  void onClose() {
    textController.dispose();
    super.onClose();
  }
  
  Future<void> initChat() async {
    if (signalingUrl.value.isEmpty) {
      Get.snackbar('Error', 'Please enter Signaling URL');
      return;
    }
    
    try {
      final signaling = RTCSignalingService(signalingUrl.value);
      _client = RTCClient(signaling, role: 'desktop', peerId: selfPeerId.value);
      await _client!.init();
      
      // Register self
      await signaling.registerPeer(selfPeerId.value, 'desktop', []);
      Get.snackbar('Success', 'Registered as ${selfPeerId.value}');
      
      // Listen for messages
      _client!.messages().listen((msg) {
        messages.add("Peer: $msg");
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
}
