import 'dart:convert';
import 'package:get/get.dart';
import 'package:desktop/core/network/network.dart';

class KnowledgeBaseController extends GetxController {
  final _files = <String>[].obs;
  List<String> get files => _files;

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
      print('Network error while fetching files: $e');
    } catch (e) {
      // Handle other errors
      print('Error while fetching files: $e');
    }
  }
}