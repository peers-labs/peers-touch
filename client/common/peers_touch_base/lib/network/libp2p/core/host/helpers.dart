/// Helper functions for working with Host objects.
library;

import 'package:peers_touch_base/network/libp2p/core/host/host.dart';
import 'package:peers_touch_base/network/libp2p/core/peer/addr_info.dart';

/// InfoFromHost returns an AddrInfo struct with the Host's ID and all of its Addrs.
AddrInfo infoFromHost(Host h) {
  return AddrInfo(
    h.id,
    h.addrs,
  );
}