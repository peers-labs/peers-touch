import 'package:connectivity_plus/connectivity_plus.dart';

class NetworkStatusService {
  final Connectivity _connectivity = Connectivity();

  Future<bool> isOnline() async {
    final results = await _connectivity.checkConnectivity();
    return results.any((r) => r != ConnectivityResult.none);
  }

  Stream<List<ConnectivityResult>> get onStatusChange => _connectivity.onConnectivityChanged;
}