import 'package:logging/logging.dart';

class AppLogger {
  static final Logger _logger = Logger('PeersTouch');

  static void d(String message) => _logger.info(message);
  static void e(String message, [Object? error, StackTrace? stackTrace]) =>
      _logger.severe(message, error, stackTrace);
}