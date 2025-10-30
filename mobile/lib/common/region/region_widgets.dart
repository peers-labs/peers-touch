import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/common/init/init_loader_regions.dart';
import 'package:peers_touch_mobile/common/region/region_manager.dart';

/// Region selection dropdown widget
class RegionDropdown extends StatefulWidget {
  final ValueChanged<RegionData?>? onChanged;
  final RegionData? value;
  final String? hintText;
  final bool showFlags;
  final bool searchable;

  const RegionDropdown({
    Key? key,
    this.onChanged,
    this.value,
    this.hintText = 'Select a country',
    this.showFlags = true,
    this.searchable = false,
  }) : super(key: key);

  @override
  State<RegionDropdown> createState() => _RegionDropdownState();
}

class _RegionDropdownState extends State<RegionDropdown> {
  final RegionManager _manager = RegionManager();
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    await _manager.initialize();
    setState(() => _initialized = true);
  }

  @override
  Widget build(BuildContext context) {
    if (!_initialized) {
      return const SizedBox(
        height: 48,
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }

    final regions = _manager.getAllRegions();
    
    return DropdownButton<RegionData>(
      value: widget.value,
      hint: Text(widget.hintText ?? 'Select a country'),
      isExpanded: true,
      items: regions.map((region) {
        return DropdownMenuItem<RegionData>(
          value: region,
          child: Row(
            children: [
              if (widget.showFlags && region.flagUrl != null) ...[
                Image.network(
                  region.flagUrl!,
                  width: 24,
                  height: 16,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const Icon(Icons.flag, size: 16),
                ),
                const SizedBox(width: 8),
              ],
              Text(region.name),
              const SizedBox(width: 4),
              Text(
                '(${region.code})',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        );
      }).toList(),
      onChanged: widget.onChanged,
    );
  }
}

/// Region search widget
class RegionSearchField extends StatefulWidget {
  final ValueChanged<RegionData?>? onSelected;
  final String? hintText;
  final bool showFlags;

  const RegionSearchField({
    Key? key,
    this.onSelected,
    this.hintText = 'Search countries...',
    this.showFlags = true,
  }) : super(key: key);

  @override
  State<RegionSearchField> createState() => _RegionSearchFieldState();
}

class _RegionSearchFieldState extends State<RegionSearchField> {
  final RegionManager _manager = RegionManager();
  final TextEditingController _controller = TextEditingController();
  List<RegionData> _filteredRegions = [];
  bool _showResults = false;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    await _manager.initialize();
  }

  void _filterRegions(String query) {
    if (query.isEmpty) {
      setState(() {
        _filteredRegions = [];
        _showResults = false;
      });
      return;
    }

    setState(() {
      _filteredRegions = _manager.searchRegions(query);
      _showResults = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _controller,
          decoration: InputDecoration(
            hintText: widget.hintText,
            prefixIcon: const Icon(Icons.search),
            suffixIcon: _controller.text.isNotEmpty
                ? IconButton(
                    icon: const Icon(Icons.clear),
                    onPressed: () {
                      _controller.clear();
                      _filterRegions('');
                    },
                  )
                : null,
          ),
          onChanged: _filterRegions,
        ),
        if (_showResults && _filteredRegions.isNotEmpty)
          Container(
            constraints: const BoxConstraints(maxHeight: 200),
            decoration: BoxDecoration(
              border: Border.all(color: Colors.grey.shade300),
              borderRadius: BorderRadius.circular(4),
            ),
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: _filteredRegions.length,
              itemBuilder: (context, index) {
                final region = _filteredRegions[index];
                return ListTile(
                  dense: true,
                  leading: widget.showFlags && region.flagUrl != null
                      ? Image.network(
                          region.flagUrl!,
                          width: 24,
                          height: 16,
                          fit: BoxFit.cover,
                        )
                      : null,
                  title: Text(region.name),
                  subtitle: Text(region.code),
                  onTap: () {
                    widget.onSelected?.call(region);
                    setState(() {
                      _controller.text = region.name;
                      _showResults = false;
                    });
                  },
                );
              },
            ),
          ),
      ],
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
}

/// Region list widget with selection
class RegionList extends StatelessWidget {
  final ValueChanged<RegionData>? onRegionSelected;
  final bool showFlags;
  final String? searchQuery;

  const RegionList({
    Key? key,
    this.onRegionSelected,
    this.showFlags = true,
    this.searchQuery,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return FutureBuilder(
      future: RegionManager().initialize(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        final regions = searchQuery != null
            ? RegionManager().searchRegions(searchQuery!)
            : RegionManager().getAllRegions();

        return ListView.builder(
          itemCount: regions.length,
          itemBuilder: (context, index) {
            final region = regions[index];
            return ListTile(
              leading: showFlags && region.flagUrl != null
                  ? Image.network(
                      region.flagUrl!,
                      width: 32,
                      height: 24,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const Icon(Icons.flag),
                    )
                  : const Icon(Icons.flag),
              title: Text(region.name),
              subtitle: Text('${region.code} ${region.capital != null ? "• ${region.capital}" : ""}'),
              onTap: () => onRegionSelected?.call(region),
            );
          },
        );
      },
    );
  }
}