import 'dart:convert';
import 'dart:io';

class RTCSignalingService {
  final String baseUrl;
  RTCSignalingService(this.baseUrl);

  Future<void> registerPeer(String id, String role, List<String> addrs) async {
    final body = json.encode({'id': id, 'role': role, 'addrs': addrs});
    final req = await HttpClient().postUrl(Uri.parse('$baseUrl/chat/peer/register'));
    req.headers.contentType = ContentType.json;
    req.write(body);
    await req.close();
  }

  Future<Map<String, dynamic>?> getPeer(String id) async {
    final resp = await HttpClient().getUrl(Uri.parse('$baseUrl/chat/peer/get?id=$id')).then((r)=>r.close());
    if (resp.statusCode != 200) return null;
    final text = await resp.transform(const Utf8Decoder()).join();
    return json.decode(text) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>?> getStats() async {
    try {
      final resp = await HttpClient().getUrl(Uri.parse('$baseUrl/chat/stats')).then((r)=>r.close());
      if (resp.statusCode != 200) return null;
      final text = await resp.transform(const Utf8Decoder()).join();
      return json.decode(text) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  Future<Map<String, dynamic>?> newSession(String a, String b) async {
    final body = json.encode({'a': a, 'b': b});
    final req = await HttpClient().postUrl(Uri.parse('$baseUrl/chat/session/new'));
    req.headers.contentType = ContentType.json;
    req.write(body);
    final resp = await req.close();
    if (resp.statusCode != 200) return null;
    final text = await resp.transform(const Utf8Decoder()).join();
    return json.decode(text) as Map<String, dynamic>;
  }

  Future<void> postOffer(String sessionId, String sdp) async {
    await _postJson('$baseUrl/chat/session/offer', {'id': sessionId, 'sdp': sdp});
  }

  Future<String?> getOffer(String sessionId) async {
    final m = await _getJson('$baseUrl/chat/session/offer?id=$sessionId');
    return m?['sdp'] as String?;
  }

  Future<void> postAnswer(String sessionId, String sdp) async {
    await _postJson('$baseUrl/chat/session/answer', {'id': sessionId, 'sdp': sdp});
  }

  Future<String?> getAnswer(String sessionId) async {
    final m = await _getJson('$baseUrl/chat/session/answer?id=$sessionId');
    return m?['sdp'] as String?;
  }

  Future<void> postCandidate(String sessionId, String candidate) async {
    await _postJson('$baseUrl/chat/session/candidate', {'id': sessionId, 'candidate': candidate});
  }

  Future<List<String>> getCandidates(String sessionId) async {
    final m = await _getJson('$baseUrl/chat/session/candidates?id=$sessionId');
    final list = m?['candidates'];
    if (list is List) {
      return list.map((e)=> e.toString()).toList();
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

