import 'package:flutter/material.dart';
import 'package:get/get.dart';
import '../controller/chat_controller.dart';

class ChatPage extends GetView<ChatController> {
  const ChatPage({Key? key}) : super(key: key);

  void _showDebugDialog(BuildContext context) {
    controller.fetchDebugStats();
    Get.dialog(
      AlertDialog(
        title: Row(
          children: [
            const Icon(Icons.bug_report),
            const SizedBox(width: 8),
            const Text('Debug Information'),
            const Spacer(),
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () => controller.fetchDebugStats(),
            ),
          ],
        ),
        content: SizedBox(
          width: 400,
          child: Obx(() {
            if (controller.isFetchingStats.value) {
              return const Center(child: CircularProgressIndicator());
            }
            final stats = controller.debugStats;
            return SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildInfoRow('Local Peer ID', controller.selfPeerId.value),
                  _buildInfoRow('Signaling URL', controller.signalingUrl.value),
                  const Divider(),
                  const Text('Backend Stats:', style: TextStyle(fontWeight: FontWeight.bold)),
                  if (stats.isEmpty)
                    const Text('No stats available (check connection)')
                  else
                    ...stats.entries.map((e) => _buildInfoRow(e.key, e.value.toString())).toList(),
                ],
              ),
            );
          }),
        ),
        actions: [
          TextButton(
            onPressed: () => Get.back(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$label: ', style: const TextStyle(fontWeight: FontWeight.bold)),
          Expanded(child: SelectableText(value)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('WebRTC Chat'),
        actions: [
          IconButton(
            icon: const Icon(Icons.info_outline),
            onPressed: () => _showDebugDialog(context),
            tooltip: 'Debug Info',
          ),
        ],
      ),
      body: Column(
        children: [
          // Config area (scrollable)
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(8.0),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        TextField(
                          decoration: const InputDecoration(labelText: 'Signaling URL'),
                          onChanged: (v) => controller.signalingUrl.value = v,
                          controller: TextEditingController(text: controller.signalingUrl.value),
                        ),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                decoration: const InputDecoration(labelText: 'My ID'),
                                onChanged: (v) => controller.selfPeerId.value = v,
                                controller: TextEditingController(text: controller.selfPeerId.value),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: TextField(
                                decoration: const InputDecoration(labelText: 'Target ID'),
                                onChanged: (v) => controller.targetPeerId.value = v,
                                controller: TextEditingController(text: controller.targetPeerId.value),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          children: [
                            ElevatedButton(
                              onPressed: () => controller.initChat(),
                              child: const Text('Init & Register'),
                            ),
                            ElevatedButton(
                              onPressed: () => controller.connect(),
                              child: const Text('Connect (Call)'),
                            ),
                            ElevatedButton(
                              onPressed: () => controller.answer(),
                              child: const Text('Answer'),
                            ),
                            ElevatedButton(
                              onPressed: () => controller.checkConnection(),
                              child: Obx(() => Text(controller.checkingConnection.value ? 'Checking...' : 'Check Connection')),
                            ),
                            ElevatedButton(
                              onPressed: () => controller.fetchConnections(),
                              child: const Text('List Connections'),
                            ),
                            ElevatedButton(
                              onPressed: () => controller.autoAnswer(),
                              child: Obx(() => Text(controller.autoAnswering.value ? 'Auto Answering...' : 'Auto Answer')),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Obx(() => Row(
                          children: [
                            Expanded(child: _buildInfoRow('Target Registered', controller.peerRegistered.value ? 'true' : 'false')),
                            Expanded(child: _buildInfoRow('PC State', controller.connectionStatus.value)),
                            Expanded(child: _buildInfoRow('DC State', controller.dataChannelStatus.value)),
                          ],
                        )),
                        const SizedBox(height: 4),
                        Obx(() {
                          final peers = controller.connectedPeers;
                          final text = peers.isEmpty ? '-' : peers.join(', ');
                          return _buildInfoRow('Connected Peers', text);
                        }),
                        Obx(() => Align(
                          alignment: Alignment.centerLeft,
                          child: Padding(
                            padding: const EdgeInsets.only(top: 4.0),
                            child: SelectableText(controller.lastCheckSummary.value),
                          ),
                        )),
                        const Divider(),
                        Obx(() {
                          final ice = controller.iceDetails;
                          if (ice.isEmpty) return const SizedBox.shrink();
                          final servers = (ice['iceServers'] as List?)?.join(', ') ?? '';
                          final local = (ice['localCandidates'] as List?)?.map((e) => '${e['type']} ${e['ip']}:${e['port']}').join('\n') ?? '';
                          final remote = (ice['remoteCandidates'] as List?)?.map((e) => '${e['type']} ${e['ip']}:${e['port']}').join('\n') ?? '';
                          final localCounts = ice['localCounts'] is Map ? (ice['localCounts'] as Map) : {};
                          final remoteCounts = ice['remoteCounts'] is Map ? (ice['remoteCounts'] as Map) : {};
                          final localSdp = ice['localSdp']?.toString() ?? '';
                          final remoteSdp = ice['remoteSdp']?.toString() ?? '';
                          final iceConn = ice['iceConnState']?.toString() ?? '';
                          final sig = ice['signalingState']?.toString() ?? '';
                          final gather = ice['iceGatheringState']?.toString() ?? '';
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _buildInfoRow('ICE Servers', servers),
                              _buildInfoRow('Signaling', sig),
                              _buildInfoRow('ICE Conn', iceConn),
                              _buildInfoRow('ICE Gathering', gather),
                              _buildInfoRow('Local SDP', localSdp.isEmpty ? '-' : localSdp),
                              _buildInfoRow('Remote SDP', remoteSdp.isEmpty ? '-' : remoteSdp),
                              _buildInfoRow('Local Candidates', local.isEmpty ? '-' : local),
                              _buildInfoRow('Remote Candidates', remote.isEmpty ? '-' : remote),
                              _buildInfoRow('Local Counts', 'host=${localCounts['host'] ?? 0}, srflx=${localCounts['srflx'] ?? 0}, relay=${localCounts['relay'] ?? 0}'),
                              _buildInfoRow('Remote Counts', 'host=${remoteCounts['host'] ?? 0}, srflx=${remoteCounts['srflx'] ?? 0}, relay=${remoteCounts['relay'] ?? 0}'),
                            ],
                          );
                        }),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: Obx(() => ListView.builder(
              itemCount: controller.messages.length,
              itemBuilder: (context, index) => ListTile(
                title: Text(controller.messages[index]),
              ),
            )),
          ),
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: Row(
              children: [
                Expanded(child: TextField(controller: controller.textController)),
                IconButton(
                  icon: const Icon(Icons.send),
                  onPressed: () => controller.sendMessage(),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
