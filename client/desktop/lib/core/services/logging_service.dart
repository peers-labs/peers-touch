import 'package:flutter/foundation.dart';
import 'package:logging/logging.dart';

/// Logging service - provides structured logging capabilities
/// Belongs to underlying kernel services, no UI, core functionality
class LoggingService {
  static final LoggingService _instance = LoggingService._internal();
  
  factory LoggingService() => _instance;
  
  LoggingService._internal();
  
  static final Logger _logger = Logger('PeersTouch');
  static bool _isInitialized = false;
  
  /// Initialize the logging system
  static void initialize({Level level = Level.INFO}) {
    if (_isInitialized) return;
    
    Logger.root.level = level;
    
    // Setup log record listener
    Logger.root.onRecord.listen((LogRecord record) {
      final message = _formatLogMessage(record);
      
      // Use debugPrint for development environment output (respects Flutter's logging preferences)
      debugPrint(message);
      
      // In production environment, can be extended to:
      // - Write to file
      // - Send to remote logging service
      // - Filter sensitive information
    });
    
    _isInitialized = true;
    info('Logging system initialized, level: $level');
  }
  
  /// Format log message (includes timestamp and level)
  static String _formatLogMessage(LogRecord record) {
    final timestamp = record.time.toIso8601String();
    final level = record.level.name.padRight(7);
    final loggerName = record.loggerName;
    final message = record.message;
    
    return '$timestamp [$level] $loggerName: $message';
  }
  
  /// Log verbose debugging information
  static void verbose(String message, [Object? error, StackTrace? stackTrace]) {
    _logger.fine(message, error, stackTrace);
  }
  
  /// Log debugging information
  static void debug(String message, [Object? error, StackTrace? stackTrace]) {
    _logger.config(message, error, stackTrace);
  }
  
  /// Log informational messages
  static void info(String message, [Object? error, StackTrace? stackTrace]) {
    _logger.info(message, error, stackTrace);
  }
  
  /// Log warning messages
  static void warning(String message, [Object? error, StackTrace? stackTrace]) {
    _logger.warning(message, error, stackTrace);
  }
  
  /// Log error messages
  static void error(String message, [Object? error, StackTrace? stackTrace]) {
    _logger.severe(message, error, stackTrace);
  }
  
  /// Log critical error messages
  static void critical(String message, [Object? error, StackTrace? stackTrace]) {
    _logger.shout(message, error, stackTrace);
  }
  
  // Backward compatibility methods
  static void d(String message) => info(message);
  static void e(String message, [Object? error, StackTrace? stackTrace]) {
    if (error != null) {
      LoggingService.error(message, error, stackTrace);
    } else {
      LoggingService.error(message, null, stackTrace);
    }
  }
}