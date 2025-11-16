import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/peers_frame/service/user_service.dart';

class PeersFrameClient {
  final IHttpService _httpService;

  late final UserService user;

  PeersFrameClient({required IHttpService httpService}) : _httpService = httpService {
    user = UserService(_httpService);
  }
}