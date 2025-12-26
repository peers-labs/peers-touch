import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/discovery/controller/discovery_controller.dart';

class RadarItem {
  final FriendItem friend;
  final double offsetX;
  final double offsetY;

  RadarItem({
    required this.friend,
    required this.offsetX,
    required this.offsetY,
  });
}

class RadarController extends GetxController with GetSingleTickerProviderStateMixin {
  late AnimationController animationController;
  final DiscoveryController _discoveryController = Get.find<DiscoveryController>();
  
  final radarItems = <RadarItem>[].obs;

  @override
  void onInit() {
    super.onInit();
    animationController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 4),
    )..repeat();

    // Listen to friends changes to update radar items
    ever(_discoveryController.friends, _updateRadarItems);
    // Initial update
    _updateRadarItems(_discoveryController.friends);
  }

  @override
  void onClose() {
    animationController.dispose();
    super.onClose();
  }

  void _updateRadarItems(List<FriendItem> friends) {
    // Simple deterministic positioning for demo purposes
    // In a real app, this could be random or based on actual location data
    final items = <RadarItem>[];
    
    if (friends.isNotEmpty) {
      items.add(RadarItem(friend: friends[0], offsetX: 100, offsetY: -50));
    }
    if (friends.length > 1) {
      items.add(RadarItem(friend: friends[1], offsetX: -80, offsetY: 80));
    }
    if (friends.length > 2) {
      items.add(RadarItem(friend: friends[2], offsetX: 120, offsetY: 60));
    }
    // Add more if needed, or loop
    
    radarItems.value = items;
  }
}
