import 'package:peers_touch_base/network/libp2p/config/config.dart';
import 'package:peers_touch_base/network/libp2p/core/multiaddr.dart';
import 'package:peers_touch_base/network/libp2p/core/peer/addr_info.dart';
import 'package:peers_touch_base/network/libp2p/p2p/host/basic/basic_host.dart';

class Libp2pNetworkService {
  BasicHost? _host;

  Future<void> initializeHost() async {
    if (_host != null) return;
    
    final config = Config();
    final host = await config.newNode();
    _host = await BasicHost.create(network: host.network, config: config);
    await _host!.start();
  }

  Future<String> testConnectivity(String address) async {
    try {
      await initializeHost();
      
      final multiAddr = MultiAddr(address);
      
      // Try to connect to the address
      try {
        final addrInfo = AddrInfo.fromMultiaddr(multiAddr);
        await _host!.connect(addrInfo);
        return 'Successfully connected to $address';
      } catch (e) {
        return 'Failed to connect to $address: $e';
      }
    } catch (e) {
      return 'Error testing connectivity: $e';
    }
  }

  Future<String> testBootstrapDiscovery(String bootstrapAddress) async {
    try {
      await initializeHost();
      
      final multiAddr = MultiAddr(bootstrapAddress);
      
      // Add bootstrap node and attempt discovery
      // Note: Bootstrap functionality needs to be implemented separately
      // as BasicHost doesn't have direct bootstrap methods
      try {
        final addrInfo = AddrInfo.fromMultiaddr(multiAddr);
        await _host!.connect(addrInfo);
        return 'Bootstrap connection successful to $bootstrapAddress. DHT functionality needs separate implementation';
      } catch (e) {
        return 'Bootstrap connection failed: $e';
      }
    } catch (e) {
      return 'Error testing bootstrap discovery: $e';
    }
  }

  Future<void> dispose() async {
    await _host?.close();
    _host = null;
  }
}