import 'package:desktop/controller/peers_center_controller.dart';
import 'package:desktop/service/backend_client.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class PeersCenterPage extends StatelessWidget {
  final BackendClient backend;
  const PeersCenterPage({super.key, required this.backend});

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(PeersCenterController(backend: backend));

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: controller.manualController,
                  decoration: const InputDecoration(
                    labelText: 'Backend Base URL',
                    hintText: 'http://127.0.0.1:8082',
                  ),
                  onChanged: (v) => controller.selectedBaseUrl.value = v,
                ),
              ),
              const SizedBox(width: 12),
              // 使用Wrap来替代Row，在小屏幕上自动换行
              Obx(() => Wrap(
                    spacing: 12,
                    alignment: WrapAlignment.end,
                    children: [
                      ElevatedButton.icon(
                        onPressed: controller.discovering.value
                            ? null
                            : controller.discover,
                        icon: const Icon(Icons.wifi_tethering),
                        label: Text(controller.discovering.value
                            ? 'Discovering...'
                            : 'Discover mDNS'),
                      ),
                      ElevatedButton.icon(
                        onPressed: controller.checking.value
                            ? null
                            : controller.checkStatus,
                        icon: const Icon(Icons.health_and_safety),
                        label: Text(controller.checking.value
                            ? 'Checking...'
                            : 'Check Status'),
                      ),
                    ],
                  )),
            ],
          ),
          const SizedBox(height: 12),
          Obx(() => controller.services.isNotEmpty
              ? SizedBox(
                  height: 120,
                  child: ListView.builder(
                    scrollDirection: Axis.horizontal,
                    itemCount: controller.services.length,
                    itemBuilder: (context, index) {
                      final s = controller.services[index];
                      final selected =
                          s.baseUrl == controller.selectedBaseUrl.value;
                      return GestureDetector(
                        onTap: () {
                          controller.selectedBaseUrl.value = s.baseUrl;
                          controller.manualController.text =
                              controller.selectedBaseUrl.value!;
                        },
                        child: Container(
                          width: 260,
                          margin: const EdgeInsets.only(right: 12),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: selected
                                ? const Color(0xFFE3F2FD)
                                : const Color(0xFFF7F7F7),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: selected
                                  ? const Color(0xFF2196F3)
                                  : const Color(0xFFE0E0E0),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                s.name,
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 6),
                              Text('URL: ${s.baseUrl}',
                                  overflow: TextOverflow.ellipsis),
                              Text('PeerID: ${s.peerId ?? '-'}',
                                  overflow: TextOverflow.ellipsis),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                )
              : const SizedBox.shrink()),
          const SizedBox(height: 16),
          // 使用LayoutBuilder根据可用宽度调整布局
          LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxWidth > 600) {
                // 宽屏幕：使用Row布局
                return Obx(() => Row(
                      children: [
                        Expanded(
                          child: Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF7F7F7),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Status',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                    'Ping: ${controller.pingMessage.value ?? '-'}'),
                                Text(
                                    'Health: ${controller.healthText.value ?? '-'}'),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(width: 16),
                        ElevatedButton.icon(
                          onPressed: controller.loadingPeers.value
                              ? null
                              : controller.loadPeers,
                          icon: const Icon(Icons.list),
                          label: Text(controller.loadingPeers.value
                              ? 'Loading...'
                              : 'Load Nodes'),
                        ),
                      ],
                    ));
              } else {
                // 窄屏幕：使用Column布局
                return Obx(() => Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF7F7F7),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Status',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                  'Ping: ${controller.pingMessage.value ?? '-'}'),
                              Text(
                                  'Health: ${controller.healthText.value ?? '-'}'),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton.icon(
                          onPressed: controller.loadingPeers.value
                              ? null
                              : controller.loadPeers,
                          icon: const Icon(Icons.list),
                          label: Text(controller.loadingPeers.value
                              ? 'Loading...'
                              : 'Load Nodes'),
                        ),
                      ],
                    ));
              }
            },
          ),

          const SizedBox(height: 16),
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFF7F7F7),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Obx(() => controller.peerList.isEmpty
                  ? const Center(child: Text('No peers loaded'))
                  : ListView.separated(
                      itemCount: controller.peerList.length,
                      separatorBuilder: (context, index) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final item = controller.peerList[index];
                        if (item is Map<String, dynamic>) {
                          final peerId = item['PeerID'] ?? item['peer_id'] ?? '';
                          final connId = item['ConnectionID'] ?? '';
                          final latency = item['Latency']?.toString() ?? '';
                          return ListTile(
                            dense: true,
                            title: Text(peerId.toString()),
                            subtitle:
                                Text('Conn: $connId   Latency: $latency'),
                          );
                        } else {
                          return ListTile(
                            dense: true,
                            title: Text(item.toString()),
                          );
                        }
                      },
                    )),
            ),
          ),
        ],
      ),
    );
  }
}