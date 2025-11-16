import 'package:get/get.dart';

class UserStatusService {
  final RxMap<String, bool> _online = <String, bool>{}.obs;

  bool isOnline(String userId) => _online[userId] ?? false;
  void setOnline(String userId, bool online) => _online[userId] = online;
}