import 'dart:async';

class NodeScanner {
  final _controller = StreamController<String>.broadcast();

  Stream<String> get onNodeFound => _controller.stream;

  Future<void> startScan() async {
    // Stub: simulate discovery
    Future.delayed(const Duration(seconds: 1), () {
      _controller.add('node-1');
    });
  }

  Future<void> stop() async {
    await _controller.close();
  }
}