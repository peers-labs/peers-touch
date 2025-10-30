import 'dart:async';

import 'package:flutter/material.dart';

import '../services/backend_client.dart';
import '../services/mdns_service.dart';

class PeersCenterPage extends StatefulWidget {
  final BackendClient backend;
  const PeersCenterPage({super.key, required this.backend});

  @override
  State<PeersCenterPage> createState() => _PeersCenterPageState();
}

class _PeersCenterPageState extends State<PeersCenterPage> {
  final _manualController = TextEditingController();
  bool _discovering = false;
  bool _checking = false;
  bool _loadingPeers = false;

  List<DiscoveredService> _services = [];
  String? _selectedBaseUrl;

  String? _pingMessage;
  String? _healthText;
  List<dynamic> _peerList = [];

  @override
  void initState() {
    super.initState();
    _selectedBaseUrl = widget.backend.baseUrl;
    _manualController.text = _selectedBaseUrl!;
  }

  @override
  void dispose() {
    _manualController.dispose();
    super.dispose();
  }

  BackendClient _currentClient() {
    final base = _selectedBaseUrl?.trim();
    if (base == null || base.isEmpty) return widget.backend;
    return widget.backend.withBaseUrl(base);
  }

  Future<void> _discover() async {
    setState(() {
      _discovering = true;
      _services = [];
    });
    try {
      final services = await MDNSService().discoverPeersTouchServices(
        timeout: const Duration(seconds: 2),
      );
      setState(() {
        _services = services;
        if (services.isNotEmpty) {
          _selectedBaseUrl = services.first.baseUrl;
          _manualController.text = _selectedBaseUrl!;
        }
      });
    } finally {
      setState(() => _discovering = false);
    }
  }

  Future<void> _checkStatus() async {
    setState(() {
      _checking = true;
      _pingMessage = null;
      _healthText = null;
    });
    try {
      final client = _currentClient();
      final ping = await client.ping();
      final health = await client.health();
      setState(() {
        _pingMessage = '${ping['status'] ?? ''} - ${ping['message'] ?? ''}';
        _healthText = health;
      });
    } catch (e) {
      setState(() {
        _pingMessage = 'error';
        _healthText = '$e';
      });
    } finally {
      setState(() => _checking = false);
    }
  }

  Future<void> _loadPeers() async {
    setState(() {
      _loadingPeers = true;
      _peerList = [];
    });
    try {
      final client = _currentClient();
      final resp = await client.listBootstrapPeers(no: 1, size: 50);
      final data = resp['data'] as Map<String, dynamic>?;
      final list = data?['list'];
      setState(() {
        _peerList = (list is List) ? list : [];
      });
    } catch (e) {
      setState(() {
        _peerList = [
          {'error': '$e'},
        ];
      });
    } finally {
      setState(() => _loadingPeers = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _manualController,
                  decoration: const InputDecoration(
                    labelText: 'Backend Base URL',
                    hintText: 'http://127.0.0.1:8082',
                  ),
                  onChanged: (v) => _selectedBaseUrl = v,
                ),
              ),
              const SizedBox(width: 12),
              ElevatedButton.icon(
                onPressed: _discovering ? null : _discover,
                icon: const Icon(Icons.wifi_tethering),
                label: Text(_discovering ? 'Discovering...' : 'Discover mDNS'),
              ),
              const SizedBox(width: 12),
              ElevatedButton.icon(
                onPressed: _checking ? null : _checkStatus,
                icon: const Icon(Icons.health_and_safety),
                label: Text(_checking ? 'Checking...' : 'Check Status'),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_services.isNotEmpty)
            SizedBox(
              height: 120,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: _services.length,
                itemBuilder: (context, index) {
                  final s = _services[index];
                  final selected = s.baseUrl == _selectedBaseUrl;
                  return GestureDetector(
                    onTap: () {
                      setState(() {
                        _selectedBaseUrl = s.baseUrl;
                        _manualController.text = _selectedBaseUrl!;
                      });
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
            ),

          const SizedBox(height: 16),
          Row(
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
                      Text('Ping: ${_pingMessage ?? '-'}'),
                      Text('Health: ${_healthText ?? '-'}'),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 16),
              ElevatedButton.icon(
                onPressed: _loadingPeers ? null : _loadPeers,
                icon: const Icon(Icons.list),
                label: Text(_loadingPeers ? 'Loading...' : 'Load Nodes'),
              ),
            ],
          ),

          const SizedBox(height: 16),
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFF7F7F7),
                borderRadius: BorderRadius.circular(12),
              ),
              child: _peerList.isEmpty
                  ? const Center(child: Text('No peers loaded'))
                  : ListView.separated(
                      itemCount: _peerList.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final item = _peerList[index];
                        if (item is Map<String, dynamic>) {
                          final peerId = item['PeerID'] ?? item['peer_id'] ?? '';
                          final connId = item['ConnectionID'] ?? '';
                          final latency = item['Latency']?.toString() ?? '';
                          return ListTile(
                            dense: true,
                            title: Text(peerId.toString()),
                            subtitle: Text('Conn: $connId   Latency: $latency'),
                          );
                        } else {
                          return ListTile(
                            dense: true,
                            title: Text(item.toString()),
                          );
                        }
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}