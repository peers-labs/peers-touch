import 'package:flutter/material.dart';

class PhotoPostItem extends StatelessWidget {
  const PhotoPostItem({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const CircleAvatar(
                radius: 20,
                backgroundImage: NetworkImage('https://picsum.photos/50'),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Friend Name',
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                  Text(
                    '2 hours ago',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Text('This is a sample post content...'),
          const SizedBox(height: 12),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              crossAxisSpacing: 4,
              mainAxisSpacing: 4,
            ),
            itemCount: 3,
            itemBuilder: (context, index) => Image.network(
              'https://picsum.photos/200?random=$index',
              fit: BoxFit.cover,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.favorite_border),
                onPressed: () {},
              ),
              IconButton(
                icon: const Icon(Icons.comment),
                onPressed: () {},
              ),
            ],
          ),
        ],
      ),
    );
  }
}
