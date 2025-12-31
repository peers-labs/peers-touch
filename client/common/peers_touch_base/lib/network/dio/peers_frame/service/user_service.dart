import 'package:peers_touch_base/network/dio/http_service.dart';

class UserService {

  UserService(this._http);
  final IHttpService _http;

  // Example method:
  // Future<User> getInfo(String userId) async {
  //   final responseData = await _http.get('/api/v1/users/$userId');
  //   return User.fromJson(responseData);
  // }
}