import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:peers_touch_desktop/features/discovery/controller/discovery_controller.dart';
import 'package:peers_touch_desktop/features/discovery/controller/radar_controller.dart';

class RadarView extends StatelessWidget {
  const RadarView({super.key});

  @override
  Widget build(BuildContext context) {
    // Ensure RadarController is initialized
    // In a strict dependency injection setup, this should be done in a Binding.
    // However, since RadarView is a sub-view dynamically shown, putting it here is acceptable for now,
    // or we could add it to DiscoveryBinding.
    final controller = Get.put(RadarController());
    final discoveryController = Get.find<DiscoveryController>();

    return Container(
      color: const Color(0xFFF5F7FB),
      child: Column(
        children: [
          Expanded(
            flex: 5,
            child: LayoutBuilder(
              builder: (context, constraints) {
                final mapSize = Size(constraints.maxWidth, constraints.maxHeight);
                return InteractiveViewer(
                  minScale: 0.6,
                  maxScale: 5.0,
                  child: Stack(
                    children: [
                      // World map background (simple neutral map)
                      Positioned.fill(
                        child: SvgPicture.asset(
                          'assets/maps/world_map.svg',
                          fit: BoxFit.cover,
                        ),
                      ),
                      // Actor markers with simple clustering
                      Obx(() {
                        final friends = discoveryController.friends;
                        final markers = _computeMarkers(friends, mapSize);
                        return Stack(children: markers);
                      }),
                    ],
                  ),
                );
              },
            ),
          ),
          Expanded(
            flex: 4,
            child: Container(
              width: double.infinity,
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(32),
                  topRight: Radius.circular(32),
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black12,
                    blurRadius: 20,
                    offset: Offset(0, -5),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.all(24.0),
                    child: Row(
                      children: [
                        const Icon(Icons.wifi_tethering, color: Colors.blue),
                        const SizedBox(width: 12),
                        const Text(
                          'Nearby Friends',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const Spacer(),
                        Obx(() => Text(
                          '${discoveryController.friends.length} Found',
                          style: const TextStyle(
                            color: Colors.grey,
                            fontWeight: FontWeight.w500,
                          ),
                        )),
                      ],
                    ),
                  ),
                  Expanded(
                    child: Obx(() => ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      itemCount: discoveryController.friends.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final friend = discoveryController.friends[index];
                        return ListTile(
                          contentPadding: const EdgeInsets.symmetric(vertical: 8),
                          leading: CircleAvatar(
                            radius: 24,
                            backgroundImage: NetworkImage(friend.avatarUrl),
                          ),
                          title: Text(
                            friend.name,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: Text(
                            friend.isOnline ? 'Online' : 'Last seen ${friend.timeOrStatus}',
                            style: TextStyle(
                              color: friend.isOnline ? Colors.green : Colors.grey,
                            ),
                          ),
                          trailing: FilledButton.tonal(
                            onPressed: () {},
                            child: const Text('Connect'),
                          ),
                        );
                      },
                    )),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _computeMarkers(List<FriendItem> friends, Size mapSize) {
    List<Offset> positions = friends.map((f) {
      if (f.lat != null && f.lon != null) {
        return _latLonToPosition(f.lat!, f.lon!, mapSize);
      }
      return _hashToPosition(f.id, mapSize);
    }).toList();
    // Density management: merge markers closer than threshold
    const double threshold = 24.0;
    final used = List<bool>.filled(positions.length, false);
    final widgets = <Widget>[];
    for (int i = 0; i < positions.length; i++) {
      if (used[i]) continue;
      final cluster = <int>[i];
      for (int j = i + 1; j < positions.length; j++) {
        if (used[j]) continue;
        if ((positions[i] - positions[j]).distance < threshold) {
          cluster.add(j);
          used[j] = true;
        }
      }
      final center = positions[i];
      if (cluster.length == 1) {
        widgets.add(_marker(center, friends[i]));
      } else {
        widgets.add(_clusterMarker(center, cluster.length));
      }
    }
    return widgets;
  }

  Offset _hashToPosition(String id, Size size) {
    final h = id.hashCode;
    final x = (h & 0xFFFF) / 0xFFFF;
    final y = ((h >> 16) & 0xFFFF) / 0xFFFF;
    return Offset(x * size.width, y * size.height);
  }

  // Simple Web Mercator projection
  Offset _latLonToPosition(double lat, double lon, Size size) {
    final x = (lon + 180.0) / 360.0 * size.width;
    final radLat = lat * math.pi / 180.0;
    final y = (0.5 - (math.log((1 + math.sin(radLat)) / (1 - math.sin(radLat))) / (4 * math.pi))) * size.height;
    // Clamp to bounds
    final cx = x.clamp(0.0, size.width);
    final cy = y.clamp(0.0, size.height);
    return Offset(cx, cy);
  }

  Widget _marker(Offset pos, FriendItem friend) {
    return Positioned(
      left: pos.dx - 12,
      top: pos.dy - 12,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircleAvatar(
            radius: 12,
            backgroundImage: NetworkImage(friend.avatarUrl),
          ),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: Colors.black54,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(friend.name, style: const TextStyle(color: Colors.white, fontSize: 10)),
          ),
        ],
      ),
    );
  }

  Widget _clusterMarker(Offset pos, int count) {
    return Positioned(
      left: pos.dx - 14,
      top: pos.dy - 14,
      child: Container(
        width: 28,
        height: 28,
        decoration: BoxDecoration(
          color: Colors.blue.withOpacity(0.2),
          shape: BoxShape.circle,
          border: Border.all(color: Colors.blue, width: 2),
        ),
        alignment: Alignment.center,
        child: Text('$count', style: const TextStyle(color: Colors.blue, fontWeight: FontWeight.bold)),
      ),
    );
  }

  Widget _buildPeerDot(double offsetX, double offsetY, FriendItem? friend) {
    if (friend == null) return const SizedBox.shrink();
    
    return Transform.translate(
      offset: Offset(offsetX, offsetY),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(2),
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 4)],
            ),
            child: CircleAvatar(
              radius: 16,
              backgroundImage: NetworkImage(friend.avatarUrl),
            ),
          ),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: Colors.black54,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              friend.name,
              style: const TextStyle(color: Colors.white, fontSize: 10),
            ),
          ),
        ],
      ),
    );
  }
}

class RadarPainter extends CustomPainter {
  final double rotationValue;

  RadarPainter(this.rotationValue);

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = math.min(size.width, size.height) / 2;

    final paint = Paint()
      ..color = Colors.blue.withOpacity(0.1)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    // Draw concentric circles
    canvas.drawCircle(center, radius * 0.3, paint);
    canvas.drawCircle(center, radius * 0.6, paint);
    canvas.drawCircle(center, radius * 0.9, paint);

    // Draw scanning line (sector)
    final scanPaint = Paint()
      ..shader = SweepGradient(
        center: Alignment.center,
        startAngle: 0,
        endAngle: math.pi / 2,
        colors: [
          Colors.blue.withOpacity(0.0),
          Colors.blue.withOpacity(0.3),
        ],
        stops: const [0.0, 1.0],
        transform: GradientRotation(rotationValue * 2 * math.pi),
      ).createShader(Rect.fromCircle(center: center, radius: radius));

    canvas.drawCircle(center, radius * 0.9, scanPaint);
  }

  @override
  bool shouldRepaint(covariant RadarPainter oldDelegate) {
    return oldDelegate.rotationValue != rotationValue;
  }
}
