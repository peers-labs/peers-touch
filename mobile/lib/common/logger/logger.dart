import 'package:logger/logger.dart';

/// Global logger instance for the application
final Logger appLogger = Logger(
  printer: PrettyPrinter(
    methodCount: 2, // Number of method calls to be displayed
    errorMethodCount: 8, // Number of method calls if stacktrace is provided
    lineLength: 120, // Width of the output
    colors: true, // Colorful log messages
    printEmojis: true, // Print an emoji for each log message
    dateTimeFormat: DateTimeFormat.none, // Should each log print contain a timestamp
  ),
);

/// Logger extensions for easier usage
extension LoggerExtension on Logger {
  /// Log debug messages (only in debug mode)
  void debug(dynamic message, [dynamic error, StackTrace? stackTrace]) {
    d(message, error: error, stackTrace: stackTrace);
  }
  
  /// Log info messages
  void info(dynamic message, [dynamic error, StackTrace? stackTrace]) {
    i(message, error: error, stackTrace: stackTrace);
  }
  
  /// Log warning messages
  void warning(dynamic message, [dynamic error, StackTrace? stackTrace]) {
    w(message, error: error, stackTrace: stackTrace);
  }
  
  /// Log error messages
  void error(dynamic message, [dynamic error, StackTrace? stackTrace]) {
    e(message, error: error, stackTrace: stackTrace);
  }
}