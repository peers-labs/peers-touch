import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class AboutSettingsPage extends StatelessWidget {
  const AboutSettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'About',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Information about Peers Touch Station',
            style: TextStyle(
              fontSize: 14,
              color: Colors.grey[600],
            ),
          ),
          const SizedBox(height: 32),
          Expanded(
            child: ListView(
              children: [
                // App Information Section
                _buildSettingsSection(
                  'Application',
                  [
                    _buildInfoTile(
                      icon: Icons.info,
                      title: 'Version',
                      subtitle: '1.0.0',
                      trailing: IconButton(
                        icon: const Icon(Icons.copy, size: 18),
                        onPressed: () {
                          Clipboard.setData(const ClipboardData(text: '1.0.0'));
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Version copied to clipboard')),
                          );
                        },
                        tooltip: 'Copy version',
                      ),
                    ),
                    _buildInfoTile(
                      icon: Icons.build,
                      title: 'Build',
                      subtitle: '2024.01.15.001',
                      trailing: IconButton(
                        icon: const Icon(Icons.copy, size: 18),
                        onPressed: () {
                          Clipboard.setData(const ClipboardData(text: '2024.01.15.001'));
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Build number copied to clipboard')),
                          );
                        },
                        tooltip: 'Copy build number',
                      ),
                    ),
                    _buildActionTile(
                      icon: Icons.update,
                      title: 'Check for updates',
                      subtitle: 'Check if a newer version is available',
                      onTap: () {
                        // TODO: Implement update check
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Checking for updates...')),
                        );
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                // Support Section
                _buildSettingsSection(
                  'Support',
                  [
                    _buildActionTile(
                      icon: Icons.help,
                      title: 'Help & Documentation',
                      subtitle: 'View user guide and documentation',
                      onTap: () {
                        // TODO: Open help documentation
                      },
                    ),
                    _buildActionTile(
                      icon: Icons.bug_report,
                      title: 'Report a bug',
                      subtitle: 'Report issues or bugs you encounter',
                      onTap: () {
                        // TODO: Open bug report
                      },
                    ),
                    _buildActionTile(
                      icon: Icons.feedback,
                      title: 'Send feedback',
                      subtitle: 'Share your thoughts and suggestions',
                      onTap: () {
                        // TODO: Open feedback form
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                // Legal Section
                _buildSettingsSection(
                  'Legal',
                  [
                    _buildActionTile(
                      icon: Icons.description,
                      title: 'Terms of Service',
                      subtitle: 'View terms and conditions',
                      onTap: () {
                        // TODO: Show terms of service
                      },
                    ),
                    _buildActionTile(
                      icon: Icons.privacy_tip,
                      title: 'Privacy Policy',
                      subtitle: 'View privacy policy',
                      onTap: () {
                        // TODO: Show privacy policy
                      },
                    ),
                    _buildActionTile(
                      icon: Icons.copyright,
                      title: 'Open Source Licenses',
                      subtitle: 'View third-party licenses',
                      onTap: () {
                        // TODO: Show licenses
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 32),
                // Footer
                Center(
                  child: Column(
                    children: [
                      const Icon(
                        Icons.cloud_queue,
                        size: 48,
                        color: Colors.grey,
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Peers Touch Station',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '© 2024 Peers Touch. All rights reserved.',
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.grey[600],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSettingsSection(String title, List<Widget> children) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: Colors.grey,
          ),
        ),
        const SizedBox(height: 12),
        Card(
          elevation: 1,
          child: Column(
            children: children,
          ),
        ),
      ],
    );
  }

  Widget _buildInfoTile({
    required IconData icon,
    required String title,
    required String subtitle,
    Widget? trailing,
  }) {
    return ListTile(
      leading: Icon(icon, color: Colors.blue),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: trailing,
    );
  }

  Widget _buildActionTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return ListTile(
      leading: Icon(icon, color: Colors.blue),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }
}