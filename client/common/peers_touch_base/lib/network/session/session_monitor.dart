import 'dart:async';

import 'package:peers_touch_base/model/domain/actor/session_api.pb.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
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
        return true;
      }
      
      final accessToken = await tokenProvider.readAccessToken();
      if (accessToken == null || accessToken.isEmpty) {
        return true;
      }
      
      final baseUrl = baseUrlProvider();
      if (baseUrl.isEmpty) {
        return true;
      }
      
      final httpService = HttpServiceLocator().httpService;
      final request = VerifySessionRequest();
      
      final response = await httpService.post<VerifySessionResponse>(
        '/api/v1/session/verify',
        data: request,
        fromJson: (bytes) => VerifySessionResponse.fromBuffer(bytes),
      );
      
      if (!response.valid) {
        onKicked('kicked');
        stop();
        return false;
      }
      
      return true;
    } catch (e) {
      return true;
    }
  }
}
