import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/model/domain/actor/online_actor.dart';

class ActivityPubClient {
  ActivityPubClient();

  Future<List<OnlineActor>> getOnlineActors() async {
    final resp = await HttpServiceLocator().httpService.getResponse<dynamic>(
      '/actors/online',
    );
    final data = resp.data;
    List list = [];
    if (data is Map) {
      final d = data['data'];
      if (d is List) {
        list = d;
      } else if (d is Map && d['items'] is List) {
        list = d['items'];
      }
    } else if (data is List) {
      list = data;
    }
    return list
        .whereType<Map>()
        .map((e) => OnlineActor.fromJson(e))
        .toList();
  }
}
