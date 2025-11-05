import 'package:get/get.dart';

import '../../core/network/api_client.dart';
import '../../core/storage/local_storage.dart';
import '../../features/shared/services/user_status_service.dart';

class InitialBinding extends Bindings {
  @override
  void dependencies() {
    Get.put<ApiClient>(ApiClient(), permanent: true);
    Get.put<LocalStorage>(LocalStorage(), permanent: true);
    Get.put<UserStatusService>(UserStatusService(), permanent: true);
  }
}