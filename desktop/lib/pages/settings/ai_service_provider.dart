import 'package:desktop/widgets/settings/provider_card.dart';
import 'package:flutter/material.dart';

class AiServiceProviderPage extends StatelessWidget {
  const AiServiceProviderPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('AI Service Provider'),
      ),
      body: ListView(
        children: [
          ProviderCard(
            providerName: 'OpenAI',
            providerDescription: 'OpenAI is a research and deployment company. They have created models like GPT-3, DALL-E, and more.',
            isEnabled: true,
          ),
          ProviderCard(
            providerName: 'Google',
            providerDescription: 'Google is a multinational technology company that specializes in Internet-related services and products.',
            isEnabled: true,
          ),
          ProviderCard(
            providerName: 'Moonshot AI',
            providerDescription: 'Moonshot AI is an AI startup that is focused on developing large-scale language models.',
            isEnabled: false,
          ),
        ],
      ),
    );
  }
}