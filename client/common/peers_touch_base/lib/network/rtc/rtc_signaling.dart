import 'dart:convert';
import 'dart:io';

class RTCSignalingService {
  final String baseUrl;
  RTCSignalingService(this.baseUrl);

  Future<void> registerPeer(String id, String role, List<String> addrs) async {
    final body = json.encode({'id': id, 'role': role, 'addrs': addrs});
    final req = await HttpClient().postUrl(Uri.parse('$baseUrl/peer/register'));
    req.headers.contentType = ContentType.json;
    req.write(body);
    await req.close();
  }

  Future<void> unregisterPeer(String id) async {
    final body = json.encode({'id': id});
    final req = await HttpClient().postUrl(Uri.parse('$baseUrl/peer/unregister'));
    req.headers.contentType = ContentType.json;
    req.write(body);
    await req.close();
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
    req.write(body);
    final resp = await req.close();
    if (resp.statusCode != 200) return null;
    final text = await resp.transform(const Utf8Decoder()).join();
    return json.decode(text) as Map<String, dynamic>;
  }

  Future<void> postOffer(String sessionId, String sdp) async {
    await _postJson('$baseUrl/session/offer', {'id': sessionId, 'sdp': sdp});
  }

  Future<String?> getOffer(String sessionId) async {
    final m = await _getJson('$baseUrl/session/offer?id=$sessionId');
    return m?['sdp'] as String?;
  }

  Future<void> postAnswer(String sessionId, String sdp) async {
    await _postJson('$baseUrl/session/answer', {'id': sessionId, 'sdp': sdp});
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
    await _postJson('$baseUrl/session/candidate', body);
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

  Future<Map<String, dynamic>?> _getJson(String url) async {
    final resp = await HttpClient().getUrl(Uri.parse(url)).then((r)=>r.close());
    if (resp.statusCode != 200) return null;
    final text = await resp.transform(const Utf8Decoder()).join();
    return json.decode(text) as Map<String, dynamic>;
  }
}
