import 'package:flutter/material.dart';
import 'package:peers_touch_ui/theme/theme.dart';

enum InputSize { small, medium, large }

class Input extends StatefulWidget {
  final String? hintText;
  final String? labelText;
  final String? errorText;
  final String? helperText;
  final TextEditingController? controller;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final VoidCallback? onTap;
  final bool obscureText;
  final bool enabled;
  final bool readOnly;
  final bool autofocus;
  final int maxLines;
  final int? maxLength;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final IconData? prefixIcon;
  final IconData? suffixIcon;
  final VoidCallback? onSuffixIconTap;
  final InputSize size;
  final FocusNode? focusNode;

  const Input({
    super.key,
    this.hintText,
    this.labelText,
    this.errorText,
    this.helperText,
    this.controller,
    this.onChanged,
    this.onSubmitted,
    this.onTap,
    this.obscureText = false,
    this.enabled = true,
    this.readOnly = false,
    this.autofocus = false,
    this.maxLines = 1,
    this.maxLength,
    this.keyboardType,
    this.textInputAction,
    this.prefixIcon,
    this.suffixIcon,
    this.onSuffixIconTap,
    this.size = InputSize.medium,
    this.focusNode,
  });

  @override
  State<Input> createState() => _InputState();
}

class _InputState extends State<Input> {
  late FocusNode _focusNode;
  bool _isFocused = false;
  bool _obscureText = false;

  @override
  void initState() {
    super.initState();
    _focusNode = widget.focusNode ?? FocusNode();
    _focusNode.addListener(_onFocusChange);
    _obscureText = widget.obscureText;
  }

  @override
  void didUpdateWidget(Input oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.obscureText != oldWidget.obscureText) {
      _obscureText = widget.obscureText;
    }
  }

  @override
  void dispose() {
    _focusNode.removeListener(_onFocusChange);
    if (widget.focusNode == null) {
      _focusNode.dispose();
    }
    super.dispose();
  }

  void _onFocusChange() {
    setState(() {
      _isFocused = _focusNode.hasFocus;
    });
  }

  double get _paddingHorizontal {
    switch (widget.size) {
      case InputSize.small:
        return AppSpacing.sm;
      case InputSize.medium:
        return AppSpacing.inputPaddingHorizontal;
      case InputSize.large:
        return AppSpacing.md;
    }
  }

  double get _paddingVertical {
    switch (widget.size) {
      case InputSize.small:
        return AppSpacing.xs;
      case InputSize.medium:
        return AppSpacing.inputPaddingVertical;
      case InputSize.large:
        return AppSpacing.md;
    }
  }

  double get _fontSize {
    switch (widget.size) {
      case InputSize.small:
        return AppTypography.fontSizeSm;
      case InputSize.medium:
        return AppTypography.fontSizeMd;
      case InputSize.large:
        return AppTypography.fontSizeLg;
    }
  }

  double get _iconSize {
    switch (widget.size) {
      case InputSize.small:
        return 14;
      case InputSize.medium:
        return 16;
      case InputSize.large:
        return 18;
    }
  }

  double get _borderWidth {
    if (widget.errorText != null) return 2;
    return _isFocused ? 2 : 1;
  }

  Color get _borderColor {
    if (widget.errorText != null) {
      return AppColors.error;
    }
    if (!widget.enabled) {
      return AppColors.border;
    }
    if (_isFocused) {
      return AppColors.primary;
    }
    return AppColors.border;
  }

  Color get _backgroundColor {
    if (!widget.enabled) {
      return AppColors.backgroundSecondary;
    }
    return AppColors.background;
  }

  Color get _textColor {
    if (!widget.enabled) {
      return AppColors.textTertiary;
    }
    return AppColors.textPrimary;
  }

  Color get _hintColor {
    return AppColors.textTertiary;
  }

  List<BoxShadow> get _shadows {
    if (_isFocused && widget.enabled) {
      return [
        BoxShadow(
          color: AppColors.primary.withOpacity(0.1),
          blurRadius: 8,
          offset: Offset(0, 2),
        ),
      ];
    }
    return [];
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.labelText != null) ...[
          AnimatedDefaultTextStyle(
            duration: const Duration(milliseconds: 150),
            style: TextStyle(
              fontFamily: AppTypography.fontFamily,
              fontSize: AppTypography.fontSizeSm,
              fontWeight: AppTypography.fontWeightMedium,
              color: _isFocused 
                  ? AppColors.primary 
                  : (widget.enabled ? AppColors.textPrimary : AppColors.textTertiary),
            ),
            child: Text(widget.labelText!),
          ),
          SizedBox(height: AppSpacing.xxs),
        ],
        AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
          padding: EdgeInsets.symmetric(
            horizontal: _paddingHorizontal,
            vertical: _paddingVertical,
          ),
          decoration: BoxDecoration(
            color: _backgroundColor,
            borderRadius: AppRadius.inputRadius,
            border: Border.all(
              color: _borderColor,
              width: _borderWidth,
            ),
            boxShadow: _shadows,
          ),
          child: Row(
            children: [
              if (widget.prefixIcon != null) ...[
                AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  child: Icon(
                    widget.prefixIcon,
                    size: _iconSize,
                    color: _isFocused ? AppColors.primary : AppColors.textTertiary,
                  ),
                ),
                SizedBox(width: AppSpacing.sm),
              ],
              Expanded(
                child: TextField(
                  controller: widget.controller,
                  focusNode: _focusNode,
                  onChanged: widget.onChanged,
                  onSubmitted: widget.onSubmitted,
                  onTap: widget.onTap,
                  obscureText: _obscureText,
                  enabled: widget.enabled,
                  readOnly: widget.readOnly,
                  autofocus: widget.autofocus,
                  maxLines: widget.maxLines,
                  maxLength: widget.maxLength,
                  keyboardType: widget.keyboardType,
                  textInputAction: widget.textInputAction,
                  style: TextStyle(
                    fontFamily: AppTypography.fontFamily,
                    fontSize: _fontSize,
                    fontWeight: AppTypography.fontWeightNormal,
                    color: _textColor,
                  ),
                  decoration: InputDecoration(
                    hintText: widget.hintText,
                    hintStyle: TextStyle(
                      fontFamily: AppTypography.fontFamily,
                      fontSize: _fontSize,
                      fontWeight: AppTypography.fontWeightNormal,
                      color: _hintColor,
                    ),
                    border: InputBorder.none,
                    contentPadding: EdgeInsets.zero,
                    isDense: true,
                    counterText: '',
                  ),
                ),
              ),
              if (widget.obscureText) ...[
                GestureDetector(
                  onTap: () {
                    setState(() {
                      _obscureText = !_obscureText;
                    });
                  },
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    child: Icon(
                      _obscureText ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                      size: _iconSize,
                      color: _isFocused ? AppColors.primary : AppColors.textTertiary,
                    ),
                  ),
                ),
              ] else if (widget.suffixIcon != null) ...[
                GestureDetector(
                  onTap: widget.onSuffixIconTap,
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    child: Icon(
                      widget.suffixIcon,
                      size: _iconSize,
                      color: _isFocused ? AppColors.primary : AppColors.textTertiary,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        if (widget.errorText != null || widget.helperText != null) ...[
          SizedBox(height: AppSpacing.xxs),
          Text(
            widget.errorText ?? widget.helperText ?? '',
            style: TextStyle(
              fontFamily: AppTypography.fontFamily,
              fontSize: AppTypography.fontSizeXs,
              fontWeight: AppTypography.fontWeightNormal,
              color: widget.errorText != null ? AppColors.error : AppColors.textTertiary,
            ),
          ),
        ],
      ],
    );
  }
}
