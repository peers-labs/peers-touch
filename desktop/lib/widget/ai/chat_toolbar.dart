import 'package:desktop/page/ai/knowledge_base_page.dart';
import 'package:desktop/widget/ai/agent_selector.dart';
import 'package:desktop/widget/ai/search_assistant.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:desktop/model/ai_model_simple.dart';
import 'package:desktop/provider/model_provider.dart';

class ChatToolbar extends StatelessWidget {
  const ChatToolbar({super.key});

  void _clearContext() {
    // TODO: Implement context clearing logic
    print('Clearing context...');
  }

  Future<void> _pickFile(BuildContext context) async {
    FilePickerResult? result = await FilePicker.platform.pickFiles();

    if (result != null) {
      PlatformFile file = result.files.first;

      var request = http.MultipartRequest('POST', Uri.parse('http://localhost:8080/ai-box/files/upload'));
      request.files.add(await http.MultipartFile.fromPath('file', file.path!));

      var response = await request.send();

      if (response.statusCode == 200) {
        print('Uploaded!');
      } else {
        print('Upload failed');
      }
    } else {
      // User canceled the picker
    }
  }

  @override
  Widget build(BuildContext context) {
    final modelProvider = Provider.of<AIModelProvider>(context);
    final currentModel = modelProvider.selectedModel;
    
    if (currentModel == null) {
      return const SizedBox.shrink();
    }

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                IconButton(onPressed: () {}, icon: const Icon(Icons.auto_awesome_outlined, size: 20), tooltip: 'Agent Settings'),
                IconButton(onPressed: () {}, icon: const Icon(Icons.text_fields_outlined, size: 20), tooltip: 'Text Formatting'),
                if (currentModel.fileUploadSupported)
                  IconButton(onPressed: () => _pickFile(context), icon: const Icon(Icons.attach_file_outlined, size: 20), tooltip: 'Attach File'),
                IconButton(onPressed: () {
                  Navigator.of(context).push(MaterialPageRoute(builder: (context) => const KnowledgeBasePage()));
                }, icon: const Icon(Icons.library_books_outlined, size: 20), tooltip: 'Knowledge Base'),
                IconButton(onPressed: () {}, icon: const Icon(Icons.grid_view_outlined, size: 20), tooltip: 'Templates'),
                const VerticalDivider(),
                IconButton(onPressed: () {}, icon: const Icon(Icons.tune_outlined, size: 20), tooltip: 'Parameters'),
                IconButton(onPressed: () {}, icon: const Icon(Icons.history_outlined, size: 20), tooltip: 'History'),
                if (currentModel.sttSupported)
                  IconButton(onPressed: () {}, icon: const Icon(Icons.mic_outlined, size: 20), tooltip: 'Voice Input'),
                IconButton(onPressed: _clearContext, icon: const Icon(Icons.layers_clear_outlined, size: 20), tooltip: 'Clear Context'),
                IconButton(onPressed: () {}, icon: const Icon(Icons.history_toggle_off_outlined, size: 20), tooltip: 'Conversation History'),
              ],
            ),
          ),
        ),
        Row(
          children: [
            const AgentSelector(),
            const SizedBox(width: 8),
            const SearchAssistant(),
            const SizedBox(width: 8),
            IconButton(onPressed: () {}, icon: const Icon(Icons.save_alt_outlined, size: 20), tooltip: 'Save Session'),
            IconButton(onPressed: () {}, icon: const Icon(Icons.send_outlined, size: 20), tooltip: 'Send'),
          ],
        )
      ],
    );
  }
}