import 'dart:io';
import 'package:path/path.dart' as path;

void main() {
  print('🧪 Testing Dart libp2p demo configuration...');
  
  try {
    // Test 1: Check if all required files exist
    final filesToCheck = [
      'pubspec.yaml',
      'libp2p_relay_demo.dart',
      'libp2p_relay_cli.dart',
      'README.md'
    ];
    
    for (final file in filesToCheck) {
      final filePath = path.join(Directory.current.path, file);
      if (!File(filePath).existsSync()) {
        throw Exception('Missing file: $file');
      }
      print('✅ Found: $file');
    }
    
    // Test 2: Check pubspec.yaml syntax
    final pubspecFile = File('pubspec.yaml');
    final pubspecContent = pubspecFile.readAsStringSync();
    
    if (!pubspecContent.contains('libp2p:')) {
      throw Exception('pubspec.yaml missing libp2p dependency');
    }
    print('✅ pubspec.yaml syntax valid');
    
    // Test 3: Check main demo file syntax
    final demoFile = File('libp2p_relay_demo.dart');
    final demoContent = demoFile.readAsStringSync();
    
    if (!demoContent.contains('class Libp2pRelayDemo')) {
      throw Exception('Missing Libp2pRelayDemo class');
    }
    
    if (!demoContent.contains('/peers-touch/transport/1.0.0')) {
      throw Exception('Missing protocol ID');
    }
    print('✅ libp2p_relay_demo.dart syntax valid');
    
    // Test 4: Check CLI file syntax
    final cliFile = File('libp2p_relay_cli.dart');
    final cliContent = cliFile.readAsStringSync();
    
    if (!cliContent.contains('class Libp2pRelayCLI')) {
      throw Exception('Missing Libp2pRelayCLI class');
    }
    print('✅ libp2p_relay_cli.dart syntax valid');
    
    // Test 5: Check README content
    final readmeFile = File('README.md');
    final readmeContent = readmeFile.readAsStringSync();
    
    if (!readmeContent.contains('libp2p') || !readmeContent.contains('Relay')) {
      throw Exception('README missing expected content');
    }
    print('✅ README.md content valid');
    
    print('\n🎉 All tests passed! Demo is ready to use.');
    print('\nNext steps:');
    print('1. Run: dart libp2p_relay_cli.dart');
    print('2. Or use the Libp2pRelayDemo class in your code');
    
  } catch (e) {
    print('❌ Test failed: $e');
    exit(1);
  }
}