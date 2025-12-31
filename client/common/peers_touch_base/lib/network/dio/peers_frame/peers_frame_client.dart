import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/peers_frame/service/ai_box_service.dart';
import 'package:peers_touch_base/network/dio/peers_frame/service/user_service.dart';

class PeersFrameClient {

  PeersFrameClient({required IHttpService httpService}) : _httpService = httpService {
    user = UserService(_httpService);
    aiBox = AiBoxService(httpService: _httpService);
  }
  final IHttpService _httpService;

  late final UserService user;
  late final AiBoxService aiBox;
}