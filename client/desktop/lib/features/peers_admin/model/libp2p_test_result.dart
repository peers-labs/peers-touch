class Libp2pTestResult {

  Libp2pTestResult({
    required this.success,
    required this.message,
    this.details,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();

  factory Libp2pTestResult.success(String message, {String? details}) {
    return Libp2pTestResult(
      success: true,
      message: message,
      details: details,
    );
  }

  factory Libp2pTestResult.failure(String message, {String? details}) {
    return Libp2pTestResult(
      success: false,
      message: message,
      details: details,
    );
  }
  final bool success;
  final String message;
  final String? details;
  final DateTime timestamp;

  @override
  String toString() {
    return 'Libp2pTestResult{success: $success, message: $message, details: $details, timestamp: $timestamp}';
  }
}