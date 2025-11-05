import 'package:get/get.dart';
import 'package:desktop/core/network/network.dart';
import 'package:logging/logging.dart';

class KnowledgeBaseController extends GetxController {
  final _files = <String>[].obs;
  List<String> get files => _files;

  final Logger _logger = Logger('KnowledgeBaseController');

  @override
  void onInit() {
    super.onInit();
    fetchFiles();
  }

  Future<void> fetchFiles() async {
    try {
      final response = await NetworkProvider.client.get<List<dynamic>>(
        '/ai-box/files/list',
        fromJson: (data) => data as List<dynamic>,
      );
      _files.value = List<String>.from(response);
    } on NetworkException catch (e) {
      // Handle network error
      _logger.warning('Network error while fetching files: $e');
    } catch (e) {
      // Handle other errors
      _logger.severe('Error while fetching files: $e');
    }
  }
}