import 'package:get/get.dart';

import '../../../core/models/actor_base.dart';

class ProfileController extends GetxController {
  final Rx<ActorBase?> user = Rx<ActorBase?>(null);

  @override
  void onInit() {
    super.onInit();
    user.value = ActorBase(id: '1', name: 'Alice');
  }
}