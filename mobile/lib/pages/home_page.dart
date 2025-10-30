import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';
import 'package:peers_touch_mobile/pages/chat/chat_list_page.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int _currentIndex = 0;
  
  final List<Widget> _pages = [
    const Center(child: Text('Home')),
    const ChatListPage(),
    const Center(child: Text('Photo')),
    const Center(child: Text('Me')),
  ];

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    
    return Scaffold(
      body: _pages[_currentIndex],
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) {
          setState(() {
            _currentIndex = index;
          });
        },
        type: BottomNavigationBarType.fixed,
        items: [
          BottomNavigationBarItem(
            icon: const Icon(Icons.home),
            label: l10n.navHome,
          ),
          BottomNavigationBarItem(
            icon: const Icon(Icons.chat),
            label: l10n.navChat,
          ),
          BottomNavigationBarItem(
            icon: const Icon(Icons.photo),
            label: l10n.navPhoto,
          ),
          BottomNavigationBarItem(
            icon: const Icon(Icons.person),
            label: l10n.navMe,
          ),
        ],
      ),
    );
  }
}