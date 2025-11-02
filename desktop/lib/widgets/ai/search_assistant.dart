import 'package:flutter/material.dart';

class SearchAssistant extends StatelessWidget {
  const SearchAssistant({super.key});

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton(
      itemBuilder: (context) => [
        PopupMenuItem(
          child: ListTile(
            leading: Icon(Icons.search_off),
            title: Text('Disable Online Search'),
            subtitle: Text('Use only the model\'s basic knowledge without performing a web search'),
          ),
        ),
        PopupMenuItem(
          child: ListTile(
            leading: Icon(Icons.search),
            title: Text('Smart Online Search'),
            subtitle: Text('Intelligently determine whether a search is needed based on the conversation content'),
          ),
        ),
      ],
      child: Row(
        children: [
          Icon(Icons.language, size: 20),
          Icon(Icons.arrow_drop_down),
        ],
      ),
    );
  }
}