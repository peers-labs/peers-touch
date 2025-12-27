import 'package:peers_touch_base/network/dio/http_service_locator.dart';

import 'heartbeat_executor.dart';

class HttpHeartbeatExecutor implements HeartbeatExecutor {
  @override
  Future<void> beat() async {
    await HttpServiceLocator().httpService.postResponse<void>('/heartbeat');
  }
}
