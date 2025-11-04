import 'dart:async';

import 'package:desktop/service/backend_client.dart';
import 'package:desktop/service/mdns_service.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class PeersCenterController extends GetxController {
  final BackendClient backend;
  PeersCenterController({required this.backend});

  final manualController = TextEditingController();
  final discovering = false.obs;
  final checking = false.obs;
  final loadingPeers = false.obs;

  final services = <DiscoveredService>[].obs;
  final selectedBaseUrl = RxnString();

  final pingMessage = RxnString();
  final healthText = RxnString();
  final peerList = <dynamic>[].obs;

  @override
  void onInit() {
    super.onInit();
    selectedBaseUrl.value = backend.baseUrl;
    manualController.text = selectedBaseUrl.value!;
  }

  @override
  void onClose() {
    manualController.dispose();
    super.onClose();
  }

  BackendClient currentClient() {
    final base = selectedBaseUrl.value?.trim();
    if (base == null || base.isEmpty) return backend;
    return backend.withBaseUrl(base);
  }

  Future<void> discover() async {
    discovering.value = true;
    services.clear();
    try {
      final result = await MDNSService().discoverPeersTouchServices(
        timeout: const Duration(seconds: 2),
      );
      services.value = result;
      if (result.isNotEmpty) {
        selectedBaseUrl.value = result.first.baseUrl;
        manualController.text = selectedBaseUrl.value!;
      }
    } finally {
      discovering.value = false;
    }
  }

  Future<void> checkStatus() async {
    checking.value = true;
    pingMessage.value = null;
    healthText.value = null;
    try {
      final client = currentClient();
      final ping = await client.ping();
      final health = await client.health();
      pingMessage.value = '${ping['status'] ?? ''} - ${ping['message'] ?? ''}';
      healthText.value = health;
    } catch (e) {
      pingMessage.value = 'error';
      healthText.value = '$e';
    } finally {
      checking.value = false;
    }
  }

  Future<void> loadPeers() async {
    loadingPeers.value = true;
    peerList.clear();
    try {
      final client = currentClient();
      final resp = await client.listBootstrapPeers(no: 1, size: 50);
      final data = resp['data'] as Map<String, dynamic>?;
      final list = data?['list'];
      peerList.value = (list is List) ? list : [];
    } catch (e) {
      peerList.value = [
        {'error': '$e'},
      ];
    } finally {
      loadingPeers.value = false;
    }
  }
}