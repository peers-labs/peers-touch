import 'package:desktop/models/ai_provider.dart';
import 'package:desktop/providers/ai_provider_state.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

class AiServiceProviderPage extends StatelessWidget {
  const AiServiceProviderPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(
            color: Colors.grey.shade300,
            height: 1.0,
          ),
        ),
      ),
      body: Row(
        children: [
          _buildLeftPanel(context),
          const VerticalDivider(width: 1),
          _buildRightPanel(context),
        ],
      ),
    );
  }

  Widget _buildLeftPanel(BuildContext context) {
    final providerState = Provider.of<AIProviderState>(context);

    return Container(
      width: 280,
      color: const Color(0xFFF9F9F9),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search Providers...',
                prefixIcon: const Icon(Icons.search, size: 20),
                filled: true,
                fillColor: Colors.white,
                contentPadding: EdgeInsets.zero,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8.0),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          Expanded(
            child: ListView(
              children: [
                _buildProviderGroup(context, 'Enabled', providerState.enabledProviders),
                _buildProviderGroup(context, 'Disabled', providerState.disabledProviders),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProviderGroup(BuildContext context, String title, List<AIProvider> providers) {
    final providerState = Provider.of<AIProviderState>(context, listen: false);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: TextStyle(color: Colors.grey.shade600, fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
          ...providers.map((provider) => ListTile(
            leading: Icon(provider.icon, color: Theme.of(context).primaryColor),
            title: Text(provider.name, style: const TextStyle(fontWeight: FontWeight.w500)),
            trailing: const Icon(Icons.circle, color: Colors.green, size: 10),
            selected: providerState.selectedProvider == provider,
            selectedTileColor: Colors.white,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            onTap: () => providerState.selectProvider(provider),
          )),
        ],
      ),
    );
  }

  Widget _buildRightPanel(BuildContext context) {
    final providerState = Provider.of<AIProviderState>(context);
    final selectedProvider = providerState.selectedProvider;

    if (selectedProvider == null) {
      return const Expanded(child: Center(child: Text('Please select a provider.')));
    }

    // For now, we only build the OpenAI panel as an example
    return Expanded(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Icon(selectedProvider.icon, size: 28, color: Theme.of(context).primaryColor),
                const SizedBox(width: 12),
                Text(selectedProvider.name, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                const Spacer(),
                Switch(value: selectedProvider.isEnabled, onChanged: (value) {
                  providerState.toggleProvider(selectedProvider);
                }),
              ],
            ),
            const SizedBox(height: 24),
            const Divider(),
            const SizedBox(height: 24),

            // Form fields
            _SettingsTextField(label: 'API Key', isPassword: true, hint: 'Please enter your OpenAI API Key'),
            _SettingsTextField(label: 'API Proxy URL', hint: 'Must include http(s)://'),
            _SettingsSwitch(label: 'Use Responses API Specification', description: 'Utilizes OpenAI\'s next-generation request format...'),
            _SettingsSwitch(label: 'Use Client Request Mode', description: 'Client request mode will initiate session requests directly...'),
            
            // Connectivity Check
            const Text('Connectivity Check', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('Test if the API Key and proxy URL are correctly filled', style: TextStyle(color: Colors.grey.shade600)),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12.0),
                    decoration: BoxDecoration(
                      color: Colors.grey.shade200,
                      borderRadius: BorderRadius.circular(8.0),
                    ),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: 'gpt-5-nano',
                        items: ['gpt-5-nano'].map((String value) {
                          return DropdownMenuItem<String>(
                            value: value,
                            child: Text(value),
                          );
                        }).toList(),
                        onChanged: (_) {},
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                ElevatedButton(onPressed: () {}, child: const Text('Check')),
              ],
            ),
            const SizedBox(height: 24),
            Center(child: Text('Your key and proxy URL will be encrypted using AES-GCM encryption algorithm', style: TextStyle(color: Colors.grey.shade600, fontSize: 12))),
            const SizedBox(height: 32),

            // Model List
            const Text('Model List', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: TextField(decoration: InputDecoration(hintText: 'Search Models...', prefixIcon: Icon(Icons.search)))),
                const SizedBox(width: 16),
                ElevatedButton.icon(onPressed: () {}, icon: const Icon(Icons.sync), label: const Text('Fetch models')),
                IconButton(onPressed: () {}, icon: const Icon(Icons.add)),
              ],
            ),
            const SizedBox(height: 16),
            // TabBar for model types would go here
          ],
        ),
      ),
    );
  }
}

// Reusable form field widgets

class _SettingsTextField extends StatelessWidget {
  final String label;
  final String hint;
  final bool isPassword;

  const _SettingsTextField({required this.label, this.hint = '', this.isPassword = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          TextField(
            obscureText: isPassword,
            decoration: InputDecoration(
              hintText: hint,
              border: const OutlineInputBorder(),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsSwitch extends StatelessWidget {
  final String label;
  final String description;

  const _SettingsSwitch({required this.label, required this.description});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
                const SizedBox(height: 4),
                Text(description, style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
              ],
            ),
          ),
          Switch(value: false, onChanged: (value) {}), // Mock value
        ],
      ),
    );
  }
}