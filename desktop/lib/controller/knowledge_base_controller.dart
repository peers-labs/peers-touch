import 'dart:convert';
import 'package:get/get.dart';
import 'package:http/http.dart' as http;

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
      final response = await http.get(Uri.parse('http://localhost:8080/ai-box/files/list'));
      if (response.statusCode == 200) {
        _files.value = List<String>.from(json.decode(response.body));
      }
    } catch (e) {
      // Handle error
    }
  }
}