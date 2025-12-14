abstract class ConnectivityAdapter {
  Future<bool> isOnline();
  Stream<List<String>> get onStatusChange;
}
