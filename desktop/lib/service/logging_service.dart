import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:logging/logging.dart';
import 'package:path_provider/path_provider.dart';
import 'package:intl/intl.dart';

// Top-level logger instance
final Logger log = Logger('PeersTouch');

Future<void> setupLogging() async {
  // Set the root logger level. All messages at this level or higher will be processed.
  Logger.root.level = Level.ALL;

  // Get the application support directory for storing logs.
  final Directory appDir = await getApplicationSupportDirectory();
  final Directory logDir = Directory('${appDir.path}/logs');
  if (!await logDir.exists()) {
    await logDir.create(recursive: true);
  }

  // Create a log file with the current date.
  final String today = DateFormat('yyyy-MM-dd').format(DateTime.now());
  final File logFile = File('${logDir.path}/app-$today.log');

  // Set up a listener to handle log records.
  Logger.root.onRecord.listen((record) {
    final String message = '${record.time}: ${record.level.name}: ${record.loggerName}: ${record.message}';

    // Print to the console (for debugging during development).
    debugPrint(message);

    // Write to the log file.
    logFile.writeAsStringSync('$message\n', mode: FileMode.append);

    // If there's an error object or stack trace, write them to the file as well.
    if (record.error != null) {
      logFile.writeAsStringSync('ERROR: ${record.error}\n', mode: FileMode.append);
    }
    if (record.stackTrace != null) {
      logFile.writeAsStringSync('STACK TRACE: ${record.stackTrace}\n', mode: FileMode.append);
    }
  });

  // Catch and log uncaught errors from the Flutter framework.
  FlutterError.onError = (FlutterErrorDetails details) {
    log.severe('Flutter error caught', details.exception, details.stack);
  };

  // Catch and log uncaught errors from the platform (e.g., async errors).
  PlatformDispatcher.instance.onError = (error, stack) {
    log.severe('Uncaught platform error', error, stack);
    return true; // Mark as handled.
  };

  log.info('Logging service initialized. Logs will be written to: ${logFile.path}');
}