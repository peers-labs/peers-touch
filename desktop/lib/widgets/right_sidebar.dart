import 'package:flutter/material.dart';

class RightSidebar extends StatelessWidget {
  const RightSidebar({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 280,
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        border: Border(left: BorderSide(color: Colors.grey.shade300)),
      ),
      child: SingleChildScrollView(
        child: Column(
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.all(8.0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Topics', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  Row(
                    children: [
                      IconButton(onPressed: () {}, icon: const Icon(Icons.calendar_today, size: 18)),
                      IconButton(onPressed: () {}, icon: const Icon(Icons.share, size: 18)),
                      IconButton(onPressed: () {}, icon: const Icon(Icons.more_horiz, size: 18)),
                    ],
                  )
                ],
              ),
            ),
            const Divider(),
            // Topic List
            ListView(
              shrinkWrap: true, // Important for ListView inside SingleChildScrollView
              physics: const NeverScrollableScrollPhysics(), // Disable inner scrolling
              children: const [
                _TopicGroup(title: 'Topic 3', isCurrent: true, children: [
                  _TopicItem(title: 'Default Topic', isTemporary: true),
                ]),
                _TopicGroup(title: 'Today', children: [
                  _TopicItem(title: 'Default Topic'),
                  _TopicItem(title: 'Default Topic'),
                ]),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _TopicGroup extends StatelessWidget {
  final String title;
  final bool isCurrent;
  final List<Widget> children;

  const _TopicGroup({required this.title, this.isCurrent = false, required this.children});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8.0, vertical: 4.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8.0, vertical: 4.0),
            child: Text(title, style: TextStyle(fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal, fontSize: 14)),
          ),
          ...children,
        ],
      ),
    );
  }
}

class _TopicItem extends StatelessWidget {
  final String title;
  final bool isTemporary;

  const _TopicItem({required this.title, this.isTemporary = false});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.chat_bubble_outline, size: 18),
      title: Text(title, style: const TextStyle(fontSize: 14)),
      trailing: isTemporary ? const Text('Temporary', style: TextStyle(color: Colors.grey, fontSize: 12)) : null,
      onTap: () {},
    );
  }
}