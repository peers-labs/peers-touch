import 'dart:async';
import 'package:peers_touch_base/network/connectivity_adapter.dart';
import 'package:peers_touch_desktop/core/services/network_status_service.dart';

class DesktopConnectivityAdapter implements ConnectivityAdapter {
  final NetworkStatusService _svc;
  DesktopConnectivityAdapter(this._svc);
  @override
  Future<bool> isOnline() => _svc.isOnline();
  @override
  Stream<List<String>> get onStatusChange async* {
    await for (final r in _svc.onStatusChange) {
      yield r.map((e) => e.toString()).toList();
    }
  }
}
