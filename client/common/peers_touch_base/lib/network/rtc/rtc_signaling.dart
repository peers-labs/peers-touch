import 'dart:convert';
import 'dart:io';

import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';

class RTCSignalingService {
  RTCSignalingService(this.baseUrl);
  final String baseUrl;

  /// Get the current JWT token from GlobalContext
  String? get _token {
    if (!Get.isRegistered<GlobalContext>()) return null;
    final gc = Get.find<GlobalContext>();
    return gc.currentSession?['accessToken'] as String?;
  }

  /// Add authorization header if token is available
  void _addAuthHeader(HttpClientRequest req) {
    final token = _token;
    if (token != null && token.isNotEmpty) {
      req.headers.add('Authorization', 'Bearer $token');
    } else {
      LoggingService.warning('RTCSignalingService: No token available for authenticated request');
    }
  }

  Future<void> registerPeer(String id, String role, List<String> addrs) async {
    final body = json.encode({'id': id, 'role': role, 'addrs': addrs});
    final req = await HttpClient().postUrl(Uri.parse('$baseUrl/peer/register'));
    req.headers.contentType = ContentType.json;
    _addAuthHeader(req);
    req.write(body);
    final resp = await req.close();
    LoggingService.info('RTCSignalingService.registerPeer: status=${resp.statusCode}');
  }

  Future<void> unregisterPeer(String id) async {
    final body = json.encode({'id': id});
    final req = await HttpClient().postUrl(Uri.parse('$baseUrl/peer/unregister'));
    req.headers.contentType = ContentType.json;
    _addAuthHeader(req);
    req.write(body);
    final resp = await req.close();
    LoggingService.info('RTCSignalingService.unregisterPeer: status=${resp.statusCode}');
  }

  Future<Map<String, dynamic>?> getPeer(String id) async {
    final resp = await HttpClient().getUrl(Uri.parse('$baseUrl/peer/get?id=$id')).then((r)=>r.close());
    if (resp.statusCode != 200) return null;
    final text = await resp.transform(const Utf8Decoder()).join();
    return json.decode(text) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>?> getStats() async {
    try {
      final resp = await HttpClient().getUrl(Uri.parse('$baseUrl/stats')).then((r)=>r.close());
      if (resp.statusCode != 200) return null;
      final text = await resp.transform(const Utf8Decoder()).join();
      return json.decode(text) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  Future<List<Map<String, dynamic>>> getPeers() async {
    final resp = await HttpClient().getUrl(Uri.parse('$baseUrl/peers')).then((r)=>r.close());
    if (resp.statusCode != 200) return [];
    final text = await resp.transform(const Utf8Decoder()).join();
    final list = json.decode(text);
    if (list is List) {
      return list.whereType<Map>().map((e)=> e.map((k,v)=> MapEntry(k.toString(), v))).toList();
    }
    return [];
  }

  Future<List<Map<String, dynamic>>> getSessions({String? peer}) async {
    final url = peer == null ? '$baseUrl/sessions' : '$baseUrl/sessions?peer=$peer';
    final resp = await HttpClient().getUrl(Uri.parse(url)).then((r)=>r.close());
    if (resp.statusCode != 200) return [];
    final text = await resp.transform(const Utf8Decoder()).join();
    final list = json.decode(text);
    if (list is List) {
      return list.whereType<Map>().map((e)=> e.map((k,v)=> MapEntry(k.toString(), v))).toList();
    }
    return [];
  }

  Future<Map<String, dynamic>?> newSession(String a, String b) async {
    final body = json.encode({'a': a, 'b': b});
    final req = await HttpClient().postUrl(Uri.parse('$baseUrl/session/new'));
    req.headers.contentType = ContentType.json;
    _addAuthHeader(req);
    req.write(body);
    final resp = await req.close();
    LoggingService.info('RTCSignalingService.newSession: status=${resp.statusCode}');
    if (resp.statusCode != 200) return null;
    final text = await resp.transform(const Utf8Decoder()).join();
    return json.decode(text) as Map<String, dynamic>;
  }

  Future<void> postOffer(String sessionId, String sdp) async {
    await _postJsonAuth('$baseUrl/session/offer', {'id': sessionId, 'sdp': sdp});
  }

  Future<String?> getOffer(String sessionId) async {
    final m = await _getJson('$baseUrl/session/offer?id=$sessionId');
    return m?['sdp'] as String?;
  }

  Future<void> postAnswer(String sessionId, String sdp) async {
    await _postJsonAuth('$baseUrl/session/answer', {'id': sessionId, 'sdp': sdp});
  }

  Future<String?> getAnswer(String sessionId) async {
    final m = await _getJson('$baseUrl/session/answer?id=$sessionId');
    return m?['sdp'] as String?;
  }

  Future<void> postCandidate(String sessionId, String candidate, {String? mid, int? mline, String? from}) async {
    final Map<String, dynamic> body = {'id': sessionId, 'candidate': candidate};
    if (mid != null) body['mid'] = mid;
    if (mline != null) body['mline'] = mline;
    if (from != null) body['from'] = from;
    await _postJsonAuth('$baseUrl/session/candidate', body);
  }

  Future<List<dynamic>> getCandidates(String sessionId, {String? excludeFrom}) async {
    final url = excludeFrom == null
        ? '$baseUrl/session/candidates?id=$sessionId'
        : '$baseUrl/session/candidates?id=$sessionId&exclude=$excludeFrom';
    final m = await _getJson(url);
    final list = m?['candidates'];
    if (list is List) {
      return list;
    }
    return [];
  }

  Future<void> _postJson(String url, Map<String, dynamic> body) async {
    final req = await HttpClient().postUrl(Uri.parse(url));
    req.headers.contentType = ContentType.json;
    req.write(json.encode(body));
    await req.close();
  }

  /// POST JSON with authentication
  Future<void> _postJsonAuth(String url, Map<String, dynamic> body) async {
    final req = await HttpClient().postUrl(Uri.parse(url));
    req.headers.contentType = ContentType.json;
    _addAuthHeader(req);
    req.write(json.encode(body));
    final resp = await req.close();
    LoggingService.info('RTCSignalingService._postJsonAuth: url=$url, status=${resp.statusCode}');
  }

  Future<Map<String, dynamic>?> _getJson(String url) async {
    final resp = await HttpClient().getUrl(Uri.parse(url)).then((r)=>r.close());
    if (resp.statusCode != 200) return null;
    final text = await resp.transform(const Utf8Decoder()).join();
    return json.decode(text) as Map<String, dynamic>;
  }
}
