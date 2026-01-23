import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

enum P2PConnectionState {
  disconnected,
  connecting,
  connected,
  failed,
}

enum ConnectionMode {
  p2pDirect,
  stationRelay,
  disconnected,
}

class ConnectionStats {
  const ConnectionStats({
    this.iceState = 'Unknown',
    this.pcState = 'Unknown',
    this.dcState = 'Unknown',
    this.signalingUrl = '',
    this.localPeerId = '',
    this.remotePeerId = '',
    this.isRegistered = false,
    this.messagesSent = 0,
    this.messagesReceived = 0,
    this.latencyMs,
    this.connectionState = P2PConnectionState.disconnected,
    this.connectionMode = ConnectionMode.disconnected,
    this.pendingSyncCount = 0,
    this.lastSyncAt,
  });

  final String iceState;
  final String pcState;
  final String dcState;
  final String signalingUrl;
  final String localPeerId;
  final String remotePeerId;
  final bool isRegistered;
  final int messagesSent;
  final int messagesReceived;
  final int? latencyMs;
  final P2PConnectionState connectionState;
  final ConnectionMode connectionMode;
  final int pendingSyncCount;
  final DateTime? lastSyncAt;

  ConnectionStats copyWith({
    String? iceState,
    String? pcState,
    String? dcState,
    String? signalingUrl,
    String? localPeerId,
    String? remotePeerId,
    bool? isRegistered,
    int? messagesSent,
    int? messagesReceived,
    int? latencyMs,
    P2PConnectionState? connectionState,
    ConnectionMode? connectionMode,
    int? pendingSyncCount,
    DateTime? lastSyncAt,
  }) {
    return ConnectionStats(
      iceState: iceState ?? this.iceState,
      pcState: pcState ?? this.pcState,
      dcState: dcState ?? this.dcState,
      signalingUrl: signalingUrl ?? this.signalingUrl,
      localPeerId: localPeerId ?? this.localPeerId,
      remotePeerId: remotePeerId ?? this.remotePeerId,
      isRegistered: isRegistered ?? this.isRegistered,
      messagesSent: messagesSent ?? this.messagesSent,
      messagesReceived: messagesReceived ?? this.messagesReceived,
      latencyMs: latencyMs ?? this.latencyMs,
      connectionState: connectionState ?? this.connectionState,
      connectionMode: connectionMode ?? this.connectionMode,
      pendingSyncCount: pendingSyncCount ?? this.pendingSyncCount,
      lastSyncAt: lastSyncAt ?? this.lastSyncAt,
    );
  }
}

class ConnectionDebugPanel extends StatelessWidget {
  const ConnectionDebugPanel({
    super.key,
    required this.stats,
    this.onRefresh,
    this.onConnect,
    this.onDisconnect,
  });

  final ConnectionStats stats;
  final VoidCallback? onRefresh;
  final VoidCallback? onConnect;
  final VoidCallback? onDisconnect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      color: UIKit.assistantSidebarBg(context),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildHeader(context, theme),
          Divider(height: 1, color: UIKit.dividerColor(context)),
          Expanded(
            child: SingleChildScrollView(
              padding: EdgeInsets.all(UIKit.spaceMd(context)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildConnectionStatus(context, theme),
                  SizedBox(height: UIKit.spaceLg(context)),
                  _buildConnectionModeSection(context, theme),
                  SizedBox(height: UIKit.spaceLg(context)),
                  _buildSignalingSection(context, theme),
                  SizedBox(height: UIKit.spaceLg(context)),
                  _buildPeerSection(context, theme),
                  SizedBox(height: UIKit.spaceLg(context)),
                  _buildStatesSection(context, theme),
                  SizedBox(height: UIKit.spaceLg(context)),
                  _buildStatsSection(context, theme),
                  SizedBox(height: UIKit.spaceLg(context)),
                  _buildSyncSection(context, theme),
                ],
              ),
            ),
          ),
          _buildActions(context, theme),
        ],
      ),
    );
  }

  Widget _buildHeader(BuildContext context, ThemeData theme) {
    return Container(
      height: UIKit.topBarHeight,
      padding: EdgeInsets.symmetric(horizontal: UIKit.spaceMd(context)),
      child: Row(
        children: [
          Icon(
            Icons.bug_report_outlined,
            size: 20,
            color: theme.colorScheme.primary,
          ),
          SizedBox(width: UIKit.spaceSm(context)),
          Text(
            'P2P Debug',
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          const Spacer(),
          if (onRefresh != null)
            IconButton(
              icon: const Icon(Icons.refresh, size: 18),
              onPressed: onRefresh,
              tooltip: 'Refresh',
            ),
        ],
      ),
    );
  }

  Widget _buildConnectionStatus(BuildContext context, ThemeData theme) {
    final (color, icon, label) = switch (stats.connectionMode) {
      ConnectionMode.p2pDirect => (
          Colors.green,
          Icons.check_circle,
          'P2P Connected'
        ),
      ConnectionMode.stationRelay => (
          Colors.blue,
          Icons.cloud,
          'Station Relay'
        ),
      ConnectionMode.disconnected => stats.connectionState == P2PConnectionState.connecting
          ? (Colors.orange, Icons.sync, 'Connecting...')
          : (Colors.grey, Icons.circle_outlined, 'Disconnected'),
    };

    return Container(
      padding: EdgeInsets.all(UIKit.spaceMd(context)),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 24),
          SizedBox(width: UIKit.spaceSm(context)),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: theme.textTheme.titleSmall?.copyWith(
                  color: color,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (stats.latencyMs != null)
                Text(
                  'Latency: ${stats.latencyMs}ms',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: UIKit.textSecondary(context),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSignalingSection(BuildContext context, ThemeData theme) {
    return _buildSection(
      context,
      theme,
      title: 'Signaling Server',
      icon: Icons.dns_outlined,
      children: [
        _buildInfoRow(context, theme, 'URL', stats.signalingUrl.isEmpty ? '-' : stats.signalingUrl),
        _buildInfoRow(
          context,
          theme,
          'Status',
          stats.isRegistered ? 'Registered' : 'Not Registered',
          valueColor: stats.isRegistered ? Colors.green : Colors.orange,
        ),
      ],
    );
  }

  Widget _buildPeerSection(BuildContext context, ThemeData theme) {
    return _buildSection(
      context,
      theme,
      title: 'Peer Info',
      icon: Icons.people_outline,
      children: [
        _buildInfoRow(context, theme, 'Local ID', stats.localPeerId.isEmpty ? '-' : stats.localPeerId),
        _buildInfoRow(context, theme, 'Remote ID', stats.remotePeerId.isEmpty ? '-' : stats.remotePeerId),
      ],
    );
  }

  Widget _buildStatesSection(BuildContext context, ThemeData theme) {
    return _buildSection(
      context,
      theme,
      title: 'Connection States',
      icon: Icons.settings_ethernet,
      children: [
        _buildStateRow(context, theme, 'ICE', stats.iceState),
        _buildStateRow(context, theme, 'PeerConnection', stats.pcState),
        _buildStateRow(context, theme, 'DataChannel', stats.dcState),
      ],
    );
  }

  Widget _buildConnectionModeSection(BuildContext context, ThemeData theme) {
    final (modeLabel, modeColor, modeIcon) = switch (stats.connectionMode) {
      ConnectionMode.p2pDirect => ('P2P Direct', Colors.green, Icons.swap_horiz),
      ConnectionMode.stationRelay => ('Station Relay', Colors.orange, Icons.cloud_queue),
      ConnectionMode.disconnected => ('Disconnected', Colors.grey, Icons.cloud_off),
    };

    return _buildSection(
      context,
      theme,
      title: 'Connection Mode',
      icon: Icons.router_outlined,
      children: [
        _buildInfoRow(
          context,
          theme,
          'Mode',
          modeLabel,
          valueColor: modeColor,
        ),
        if (stats.latencyMs != null)
          _buildInfoRow(context, theme, 'Latency', '${stats.latencyMs}ms'),
      ],
    );
  }

  Widget _buildStatsSection(BuildContext context, ThemeData theme) {
    return _buildSection(
      context,
      theme,
      title: 'Message Statistics',
      icon: Icons.analytics_outlined,
      children: [
        _buildInfoRow(context, theme, 'Sent', '${stats.messagesSent}'),
        _buildInfoRow(context, theme, 'Received', '${stats.messagesReceived}'),
      ],
    );
  }

  Widget _buildSyncSection(BuildContext context, ThemeData theme) {
    final lastSyncText = stats.lastSyncAt != null
        ? _formatTimeSince(stats.lastSyncAt!)
        : 'Never';

    return _buildSection(
      context,
      theme,
      title: 'Sync Status',
      icon: Icons.sync,
      children: [
        _buildInfoRow(context, theme, 'Pending', '${stats.pendingSyncCount} messages'),
        _buildInfoRow(context, theme, 'Last Sync', lastSyncText),
      ],
    );
  }

  String _formatTimeSince(DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);
    
    if (diff.inSeconds < 60) {
      return '${diff.inSeconds}s ago';
    } else if (diff.inMinutes < 60) {
      return '${diff.inMinutes}m ago';
    } else if (diff.inHours < 24) {
      return '${diff.inHours}h ago';
    } else {
      return '${diff.inDays}d ago';
    }
  }

  Widget _buildSection(
    BuildContext context,
    ThemeData theme, {
    required String title,
    required IconData icon,
    required List<Widget> children,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 16, color: UIKit.textSecondary(context)),
            SizedBox(width: UIKit.spaceXs(context)),
            Text(
              title,
              style: theme.textTheme.labelLarge?.copyWith(
                color: UIKit.textSecondary(context),
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
        SizedBox(height: UIKit.spaceSm(context)),
        Container(
          padding: EdgeInsets.all(UIKit.spaceSm(context)),
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
          ),
          child: Column(children: children),
        ),
      ],
    );
  }

  Widget _buildInfoRow(
    BuildContext context,
    ThemeData theme,
    String label,
    String value, {
    Color? valueColor,
  }) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: UIKit.spaceXs(context)),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: UIKit.textSecondary(context),
            ),
          ),
          Flexible(
            child: Text(
              value,
              style: theme.textTheme.bodySmall?.copyWith(
                color: valueColor ?? theme.colorScheme.onSurface,
                fontFamily: 'monospace',
              ),
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStateRow(
    BuildContext context,
    ThemeData theme,
    String label,
    String state,
  ) {
    final color = _getStateColor(state);
    return Padding(
      padding: EdgeInsets.symmetric(vertical: UIKit.spaceXs(context)),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: UIKit.textSecondary(context),
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              state,
              style: theme.textTheme.labelSmall?.copyWith(
                color: color,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _getStateColor(String state) {
    final lower = state.toLowerCase();
    if (lower.contains('connected') || lower.contains('open') || lower.contains('complete')) {
      return Colors.green;
    } else if (lower.contains('connecting') || lower.contains('checking') || lower.contains('new')) {
      return Colors.orange;
    } else if (lower.contains('failed') || lower.contains('closed') || lower.contains('disconnected')) {
      return Colors.red;
    }
    return Colors.grey;
  }

  Widget _buildActions(BuildContext context, ThemeData theme) {
    return Container(
      padding: EdgeInsets.all(UIKit.spaceMd(context)),
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: UIKit.dividerColor(context)),
        ),
      ),
      child: Row(
        children: [
          if (stats.connectionState == P2PConnectionState.disconnected ||
              stats.connectionState == P2PConnectionState.failed)
            Expanded(
              child: FilledButton.icon(
                onPressed: onConnect,
                icon: const Icon(Icons.link, size: 18),
                label: const Text('Connect'),
              ),
            )
          else
            Expanded(
              child: OutlinedButton.icon(
                onPressed: onDisconnect,
                icon: const Icon(Icons.link_off, size: 18),
                label: const Text('Disconnect'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.red,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
