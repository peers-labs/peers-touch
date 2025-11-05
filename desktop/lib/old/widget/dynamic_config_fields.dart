import 'package:flutter/material.dart';
import '../model/ai_provider.dart';

/// Dynamic configuration fields widget that renders different input types
/// based on ConfigField definitions from AI provider metadata
class DynamicConfigFields extends StatefulWidget {
  final List<ConfigField> configFields;
  final Map<String, dynamic> initialConfig;
  final Function(Map<String, dynamic>) onConfigChanged;
  final Function(bool) onValidationChanged;

  const DynamicConfigFields({
    super.key,
    required this.configFields,
    required this.initialConfig,
    required this.onConfigChanged,
    required this.onValidationChanged,
  });

  @override
  State<DynamicConfigFields> createState() => _DynamicConfigFieldsState();
}

class _DynamicConfigFieldsState extends State<DynamicConfigFields> {
  late Map<String, TextEditingController> _controllers;
  late Map<String, dynamic> _config;
  final Map<String, String?> _validationErrors = {};

  @override
  void initState() {
    super.initState();
    _config = Map<String, dynamic>.from(widget.initialConfig);
    _controllers = {};

    // Initialize controllers for text fields
    for (final field in widget.configFields) {
      if (field.type == 'string') {
        final value = _config[field.name]?.toString() ?? 
                     field.defaultValue?.toString() ?? '';
        _controllers[field.name] = TextEditingController(text: value);
        _config[field.name] = value;
      } else if (field.type == 'boolean') {
        _config[field.name] = _config[field.name] ?? 
                             field.defaultValue ?? false;
      }
    }
    
    _validateAllFields();
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  void _validateAllFields() {
    bool hasErrors = false;
    _validationErrors.clear();

    for (final field in widget.configFields) {
      final error = _validateField(field, _config[field.name]);
      if (error != null) {
        _validationErrors[field.name] = error;
        hasErrors = true;
      }
    }

    widget.onValidationChanged(!hasErrors);
  }

  String? _validateField(ConfigField field, dynamic value) {
    // Check required fields
    if (field.required) {
      if (value == null || 
          (value is String && value.trim().isEmpty) ||
          (value is bool && value == false && field.type == 'boolean')) {
        return '${_formatFieldLabel(field.name)} is required';
      }
    }

    // Type-specific validation
    if (value != null) {
      switch (field.type) {
        case 'string':
          if (value is! String) {
            return '${_formatFieldLabel(field.name)} must be a string';
          }
          // URL validation for endpoint fields
          if (field.name.toLowerCase().contains('endpoint') || 
              field.name.toLowerCase().contains('url')) {
            if (!_isValidUrl(value)) {
              return '${_formatFieldLabel(field.name)} must be a valid URL';
            }
          }
          break;
        case 'number':
          if (value is String) {
            if (double.tryParse(value) == null) {
              return '${_formatFieldLabel(field.name)} must be a valid number';
            }
          } else if (value is! num) {
            return '${_formatFieldLabel(field.name)} must be a number';
          }
          break;
        case 'boolean':
          if (value is! bool) {
            return '${_formatFieldLabel(field.name)} must be true or false';
          }
          break;
      }
    }

    return null;
  }

  bool _isValidUrl(String url) {
    try {
      final uri = Uri.parse(url);
      return uri.hasScheme && (uri.scheme == 'http' || uri.scheme == 'https');
    } catch (e) {
      return false;
    }
  }

  void _updateConfig(String key, dynamic value) {
      _config[key] = value;
      
      // Validate the specific field
      final field = widget.configFields.firstWhere((f) => f.name == key);
      final error = _validateField(field, value);
      
      if (error != null) {
        _validationErrors[key] = error;
      } else {
        _validationErrors.remove(key);
      }
      
      // Check overall validation status
      _validateAllFields();
    });
    
    // Only notify parent of config changes if validation passes
    if (_validationErrors.isEmpty) {
      widget.onConfigChanged(_config);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.configFields.isEmpty) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: widget.configFields.map((field) => _buildField(field)).toList(),
    );
  }

  Widget _buildField(ConfigField field) {
    switch (field.type) {
      case 'string':
        return _buildStringField(field);
      case 'boolean':
        return _buildBooleanField(field);
      case 'number':
        return _buildNumberField(field);
      default:
        return _buildStringField(field);
    }
  }

  Widget _buildStringField(ConfigField field) {
    final controller = _controllers[field.name]!;
    final isPassword = field.name.toLowerCase().contains('key') || 
                      field.name.toLowerCase().contains('token');

    return Padding(
      padding: const EdgeInsets.only(bottom: 24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                _formatFieldLabel(field.name),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                ),
              ),
              if (field.required) ...[
                const SizedBox(width: 4),
                const Text(
                  '*',
                  style: TextStyle(color: Colors.red, fontSize: 16),
                ),
              ],
            ],
          ),
          if (field.description.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              field.description,
              style: TextStyle(
                fontSize: 12,
                color: Colors.grey[600],
              ),
            ),
          ],
          const SizedBox(height: 8),
          TextField(
            controller: controller,
            obscureText: isPassword,
            decoration: InputDecoration(
              hintText: _getFieldHint(field),
              border: const OutlineInputBorder(),
              errorBorder: _validationErrors.containsKey(field.name)
                  ? const OutlineInputBorder(
                      borderSide: BorderSide(color: Colors.red),
                    )
                  : null,
              errorText: _validationErrors[field.name],
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 12,
              ),
              suffixIcon: isPassword
                  ? const Icon(Icons.visibility_off)
                  : null,
            ),
            onChanged: (value) => _updateConfig(field.name, value),
          ),
        ],
      ),
    );
  }

  Widget _buildBooleanField(ConfigField field) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 24.0),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _formatFieldLabel(field.name),
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (field.description.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    field.description,
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.grey[600],
                    ),
                  ),
                ],
              ],
            ),
          ),
          Switch(
            value: _config[field.name] ?? false,
            onChanged: (value) => _updateConfig(field.name, value),
          ),
        ],
      ),
    );
  }

  Widget _buildNumberField(ConfigField field) {
    final controller = _controllers[field.name] ??= TextEditingController(
      text: (_config[field.name] ?? field.defaultValue ?? '').toString(),
    );

    return Padding(
      padding: const EdgeInsets.only(bottom: 24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                _formatFieldLabel(field.name),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                ),
              ),
              if (field.required) ...[
                const SizedBox(width: 4),
                const Text(
                  '*',
                  style: TextStyle(color: Colors.red, fontSize: 16),
                ),
              ],
            ],
          ),
          if (field.description.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              field.description,
              style: TextStyle(
                fontSize: 12,
                color: Colors.grey[600],
              ),
            ),
          ],
          const SizedBox(height: 8),
          TextField(
            controller: controller,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              hintText: _getFieldHint(field),
              border: const OutlineInputBorder(),
              errorBorder: _validationErrors.containsKey(field.name)
                  ? const OutlineInputBorder(
                      borderSide: BorderSide(color: Colors.red),
                    )
                  : null,
              errorText: _validationErrors[field.name],
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 12,
              ),
            ),
            onChanged: (value) {
              final numValue = double.tryParse(value);
              _updateConfig(field.name, numValue ?? value);
            },
          ),
        ],
      ),
    );
  }

  String _formatFieldLabel(String fieldName) {
    // Convert snake_case to Title Case
    return fieldName
        .split('_')
        .map((word) => word[0].toUpperCase() + word.substring(1))
        .join(' ');
  }

  String _getFieldHint(ConfigField field) {
    if (field.defaultValue != null) {
      return field.defaultValue.toString();
    }
    
    switch (field.name.toLowerCase()) {
      case 'api_key':
        return 'Enter your API key';
      case 'proxy_url':
      case 'endpoint':
        return 'https://api.example.com';
      case 'origins':
        return '*';
      default:
        return 'Enter ${_formatFieldLabel(field.name).toLowerCase()}';
    }
  }
}