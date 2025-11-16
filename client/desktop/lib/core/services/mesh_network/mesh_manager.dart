class MeshManager {
  bool connected = false;

  Future<void> connect() async {
    connected = true;
  }

  Future<void> disconnect() async {
    connected = false;
  }
}