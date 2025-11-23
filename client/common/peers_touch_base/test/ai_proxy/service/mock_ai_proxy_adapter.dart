import 'package:mockito/annotations.dart';
import 'package:peers_touch_base/ai_proxy/adapter/ai_proxy_adapter.dart';
import 'package:peers_touch_base/ai_proxy/client/chat_client.dart';
import 'package:peers_touch_base/ai_proxy/provider/rich_provider.dart';

@GenerateMocks([AiProxyAdapter, RichProvider, ChatClient])
void main() {}
