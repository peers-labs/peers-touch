import 'package:desktop/models/ai_provider.dart';
import 'package:desktop/providers/ai_provider_state_interface.dart';
import 'package:desktop/widgets/provider_card.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

class AiServiceProviderPage extends StatelessWidget {
  const AiServiceProviderPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Service Provider'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(
            color: Colors.grey.shade300,
            height: 1.0,
          ),
        ),
      ),
      body: Consumer<AIProviderStateInterface>(
        builder: (context, providerState, child) {
          if (providerState.isLoading && providerState.providers.isEmpty) {
            return const Center(child: CircularProgressIndicator());
          }

          return SingleChildScrollView(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildProviderSection(context, 'Enabled', providerState.enabledProviders),
                const SizedBox(height: 32),
                _buildProviderSection(context, 'Disabled', providerState.disabledProviders),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildProviderSection(BuildContext context, String title, List<AIProvider> providers) {
    final providerState = Provider.of<AIProviderStateInterface>(context, listen: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$title (${providers.length})',
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 16),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 400,
            crossAxisSpacing: 16,
            mainAxisSpacing: 16,
            childAspectRatio: 1.8, // Adjust aspect ratio for better card layout
          ),
          itemCount: providers.length,
          itemBuilder: (context, index) {
            final provider = providers[index];
            return ProviderCard(
              provider: provider,
              onEnabledChanged: (bool isEnabled) {
                providerState.toggleProvider(provider);
              },
            );
          },
        ),
      ],
    );
  }
}