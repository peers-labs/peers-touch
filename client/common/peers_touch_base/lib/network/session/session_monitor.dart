import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:peers_touch_base/network/token_provider.dart';

/// Monitors session validity and handles kick detection
class SessionMonitor {
  SessionMonitor({
    required this.tokenProvider,
    required this.baseUrlProvider,
    required this.onKicked,
    this.checkInterval = const Duration(seconds: 30),
  });
  
  final TokenProvider tokenProvider;
  final String Function() baseUrlProvider;
  final void Function(String reason) onKicked;
  final Duration checkInterval;
  
  Timer? _timer;
  bool _isRunning = false;
  
  /// Start monitoring session validity
  void start() {
    if (_isRunning) return;
    _isRunning = true;
    
    // Initial check after 5 seconds
    _timer = Timer(const Duration(seconds: 5), () {
      _checkSession();
      // Then regular checks
      _timer = Timer.periodic(checkInterval, (_) => _checkSession());
    });
  }
  
  /// Stop monitoring
  void stop() {
    _isRunning = false;
    _timer?.cancel();
    _timer = null;
  }
  
  /// Manual check for session validity
  Future<bool> checkNow() async {
    return await _checkSession();
  }
  
  Future<bool> _checkSession() async {
    try {
      final sessionId = await tokenProvider.readSessionId();
      if (sessionId == null || sessionId.isEmpty) {
        return true; // No session to check
      }
      
      final accessToken = await tokenProvider.readAccessToken();
      if (accessToken == null || accessToken.isEmpty) {
        return true; // No token
      }
      
      final baseUrl = baseUrlProvider();
      if (baseUrl.isEmpty) {
        return true;
      }
      
      final uri = Uri.parse(
        baseUrl.endsWith('/')
            ? '${baseUrl}api/v1/session/verify'
            : '$baseUrl/api/v1/session/verify',
      );
      
      final client = HttpClient();
      final request = await client.getUrl(uri);
      request.headers.set('Authorization', 'Bearer $accessToken');
      request.headers.set('X-Session-ID', sessionId);
      
      final response = await request.close();
      final body = await response.transform(const Utf8Decoder()).join();
      
      if (response.statusCode == 200) {
        final data = json.decode(body);
        if (data is Map) {
          final valid = data['valid'] == true;
          final reason = data['reason']?.toString() ?? '';
          
          if (!valid && reason == 'kicked') {
            onKicked(reason);
            stop();
            return false;
          }
        }
      } else if (response.statusCode == 401) {
        // Token is invalid, might be kicked
        onKicked('unauthorized');
        stop();
        return false;
      }
      
      return true;
    } catch (e) {
      // Network error, don't trigger kick
      return true;
    }
  }
}
