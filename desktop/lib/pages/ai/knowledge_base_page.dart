import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class KnowledgeBasePage extends StatefulWidget {
  const KnowledgeBasePage({super.key});

  @override
  State<KnowledgeBasePage> createState() => _KnowledgeBasePageState();
}

class _KnowledgeBasePageState extends State<KnowledgeBasePage> {
  List<String> _files = [];

  @override
  void initState() {
    super.initState();
    _fetchFiles();
  }

  Future<void> _fetchFiles() async {
    final response = await http.get(Uri.parse('http://localhost:8080/ai-box/files/list'));
    if (response.statusCode == 200) {
      setState(() {
        _files = List<String>.from(json.decode(response.body));
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Knowledge Base'),
      ),
      body: ListView.builder(
        itemCount: _files.length,
        itemBuilder: (context, index) {
          return ListTile(
            title: Text(_files[index]),
            leading: Icon(Icons.insert_drive_file),
          );
        },
      ),
    );
  }
}