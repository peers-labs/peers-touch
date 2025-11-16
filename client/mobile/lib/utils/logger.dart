class Logger {
  final String tag;

  Logger(this.tag);

  void d(String message) {
    // ignore: avoid_print
    print('[$tag] DEBUG: $message');
  }

  void i(String message) {
    // ignore: avoid_print
    print('[$tag] INFO: $message');
  }

  void w(String message) {
    // ignore: avoid_print
    print('[$tag] WARN: $message');
  }

  void e(String message) {
    // ignore: avoid_print
    print('[$tag] ERROR: $message');
  }
}

final appLogger = Logger('PeersTouch');