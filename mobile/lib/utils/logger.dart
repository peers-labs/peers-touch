class Logger {
  final String tag;

  Logger(this.tag);

  void d(String message) {
    print('[$tag] DEBUG: $message');
  }

  void i(String message) {
    print('[$tag] INFO: $message');
  }

  void w(String message) {
    print('[$tag] WARN: $message');
  }

  void e(String message) {
    print('[$tag] ERROR: $message');
  }
}

final appLogger = Logger('PeersTouch');