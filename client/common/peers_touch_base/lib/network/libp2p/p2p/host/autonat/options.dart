import 'package:peers_touch_base/network/libp2p/core/host/host.dart';
import 'package:peers_touch_base/network/libp2p/core/multiaddr.dart';
import 'package:peers_touch_base/network/libp2p/core/network/network.dart';
import 'package:peers_touch_base/network/libp2p/p2p/host/autonat/client.dart' show AddrFunc; // Keep AddrFunc import if it's defined there and not moved
// Assuming AddrFunc is defined/imported from elsewhere (e.g. client.dart or a common types file)
// MetricsTracer is now imported from ./metrics.dart
import 'package:peers_touch_base/network/libp2p/p2p/host/autonat/metrics.dart' show MetricsTracer;


// Placeholder for DialPolicy, should be defined in its own file
abstract class DialPolicy {
  bool skipDial(MultiAddr addr);
  // Add skipPeer to the interface
  bool skipPeer(List<MultiAddr> addrs);
}

class AutoNATOption {
  AutoNATOption(this._apply);
  final Function(AutoNATConfig) _apply;
  void apply(AutoNATConfig config) => _apply(config);
}

class AutoNATConfig {

  AutoNATConfig({
    required this.host,
    required this.dialPolicy,
    // Other fields will be set by defaults or options
  }) {
    // Apply defaults (can be a separate static method too)
    // addressFunc is set if UsingAddresses is not called, or defaults to host.addrs in New()
    // dialer is set by EnableService
  }
  Host host; // Made non-final to be modifiable by options

  AddrFunc? addressFunc;
  DialPolicy dialPolicy;
  Network? dialer; // Can be null if service not enabled
  bool forceReachability = false;
  Reachability reachability = Reachability.unknown; // Default from network.dart
  MetricsTracer? metricsTracer;

  // client
  Duration bootDelay = const Duration(seconds: 15);
  Duration retryInterval = const Duration(seconds: 90);
  Duration refreshInterval = const Duration(minutes: 15);
  Duration requestTimeout = const Duration(seconds: 30);
  Duration throttlePeerPeriod = const Duration(seconds: 90);

  // server
  Duration dialTimeout = const Duration(seconds: 15);
  int maxPeerAddresses = 16;
  int throttleGlobalMax = 30;
  int throttlePeerMax = 3;
  Duration throttleResetPeriod = const Duration(minutes: 1);
  Duration throttleResetJitter = const Duration(seconds: 15);

  static const Duration maxRefreshInterval = Duration(hours: 24);
}

// Option functions - Dart style

AutoNATOption enableService(Network dialer) {
  return AutoNATOption((AutoNATConfig c) {
    if (dialer == c.host.network || dialer.peerstore == c.host.peerStore) {
      throw ArgumentError('Dialer should not be that of the host or share its peerstore');
    }
    c.dialer = dialer;
  });
}

AutoNATOption withReachability(Reachability reachability) {
  return AutoNATOption((AutoNATConfig c) {
    c.forceReachability = true;
    c.reachability = reachability;
  });
}

AutoNATOption usingAddresses(AddrFunc addrFunc) {
  return AutoNATOption((AutoNATConfig c) {
    c.addressFunc = addrFunc;
  });
}

AutoNATOption withSchedule(Duration retryInterval, Duration refreshInterval) {
  return AutoNATOption((AutoNATConfig c) {
    c.retryInterval = retryInterval;
    c.refreshInterval = refreshInterval;
  });
}

AutoNATOption withoutStartupDelay() {
  return AutoNATOption((AutoNATConfig c) {
    c.bootDelay = const Duration(microseconds: 1); // Effectively no delay
  });
}

AutoNATOption withoutThrottling() {
  return AutoNATOption((AutoNATConfig c) {
    c.throttleGlobalMax = 0;
  });
}

AutoNATOption withThrottling(int amount, Duration interval) {
  return AutoNATOption((AutoNATConfig c) {
    c.throttleGlobalMax = amount;
    c.throttleResetPeriod = interval;
    c.throttleResetJitter = Duration(microseconds: interval.inMicroseconds ~/ 4);
  });
}

AutoNATOption withPeerThrottling(int amount) {
  return AutoNATOption((AutoNATConfig c) {
    c.throttlePeerMax = amount;
  });
}

AutoNATOption withMetricsTracer(MetricsTracer mt) {
  return AutoNATOption((AutoNATConfig c) {
    c.metricsTracer = mt;
  });
}

// Helper to apply multiple options
void applyOptions(AutoNATConfig config, List<AutoNATOption> options) {
  for (var opt in options) {
    opt.apply(config);
  }
}
