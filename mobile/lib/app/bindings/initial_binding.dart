import 'package:get/get.dart';
import 'package:peers_touch_mobile/core/network/api_client.dart';
import 'package:peers_touch_mobile/core/storage/local_storage.dart';

class InitialBinding extends Bindings {
  @override
  void dependencies() {
    // Register global services
    Get.put<ApiClient>(ApiClient(), permanent: true);
    Get.put<StorageService>(StorageService(), permanent: true);
  }
}