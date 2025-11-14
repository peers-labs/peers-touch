import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/core/ui/ui_kit.dart';

class CreateProviderDialog extends StatefulWidget {
  final Function(String) onCreated;

  const CreateProviderDialog({super.key, required this.onCreated});

  @override
  _CreateProviderDialogState createState() => _CreateProviderDialogState();
}

class _CreateProviderDialogState extends State<CreateProviderDialog> {
  final TextEditingController controller = TextEditingController();

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Create Provider'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: controller,
            decoration: const InputDecoration(
              labelText: 'Provider Name',
              hintText: 'Enter provider name',
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: () {
            widget.onCreated(controller.text);
            Navigator.pop(context);
          },
          style: Theme.of(context).elevatedButtonTheme.style?.copyWith(
            padding: MaterialStateProperty.all(const EdgeInsets.symmetric(vertical: 20)),
          ),
          child: const Text('Create'),
        ),
      ],
    );
  }
}
