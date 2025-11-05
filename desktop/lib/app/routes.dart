import 'package:get/get.dart';
import '../modules/ai_chat/ai_chat_view.dart';
import '../modules/settings/settings_view.dart';
import '../modules/peers_center/peers_center_view.dart';
import '../modules/ai_chat/ai_chat_binding.dart';
import '../modules/settings/settings_binding.dart';
import '../modules/peers_center/peers_center_binding.dart';

List<GetPage> getPages() => [
  GetPage(name: '/ai-chat',       page: () => const AiChatView(),       binding: AiChatBinding()),
  GetPage(name: '/settings',      page: () => const SettingsView(),     binding: SettingsBinding()),
  GetPage(name: '/peers-center',  page: () => const PeersCenterView(), binding: PeersCenterBinding()),
];