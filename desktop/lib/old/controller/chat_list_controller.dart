import 'package:get/get.dart';
import 'package:peers_touch_desktop/model/ai_model_simple.dart';

class ChatListController extends GetxController {
  final _selectedIndex = RxnInt();
  int? get selectedIndex => _selectedIndex.value;

  void selectChat(int index) {
    _selectedIndex.value = index;
  }

  String getProviderName(ModelProvider provider) {
    switch (provider) {
      case ModelProvider.openai:
        return 'OpenAI';
      case ModelProvider.google:
        return 'Google';
      case ModelProvider.anthropic:
        return 'Anthropic';
      case ModelProvider.moonshot:
        return 'Moonshot AI';
      case ModelProvider.ollama:
        return 'Ollama';
      case ModelProvider.custom:
        return 'Custom';
      default:
        return 'Unknown';
    }
  }
}