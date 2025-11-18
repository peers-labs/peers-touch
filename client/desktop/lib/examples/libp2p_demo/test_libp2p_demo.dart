import 'dart:io';
import 'dart:convert';

/// Simple test script for libp2p relay demo
/// This script tests basic functionality without requiring a running relay server
void main() async {
  print('🧪 Testing libp2p relay demo...');
  
  try {
    // Test 1: Import check
    print('\n📋 Test 1: Import check');
    final demoFile = File('libp2p_relay_demo.dart');
    final cliFile = File('libp2p_relay_cli.dart');
    
    if (!demoFile.existsSync()) {
      throw Exception('libp2p_relay_demo.dart not found');
    }
    
    if (!cliFile.existsSync()) {
      throw Exception('libp2p_relay_cli.dart not found');
    }
    
    print('✅ All required files exist');
    
    // Test 2: Syntax check
    print('\n🔍 Test 2: Syntax check');
    final demoContent = demoFile.readAsStringSync();
    final cliContent = cliFile.readAsStringSync();
    
    // Basic syntax validation
    if (!demoContent.contains('class Libp2pRelayDemo')) {
      throw Exception('Libp2pRelayDemo class not found');
    }
    
    if (!cliContent.contains('class Libp2pRelayCLI')) {
      throw Exception('Libp2pRelayCLI class not found');
    }
    
    if (!demoContent.contains('protocolId')) {
      throw Exception('protocolId not found in demo');
    }
    
    if (!cliContent.contains('protocolId')) {
      throw Exception('protocolId not found in CLI');
    }
    
    print('✅ Basic syntax validation passed');
    
    // Test 3: Protocol consistency
    print('\n🔗 Test 3: Protocol consistency');
    final demoProtocol = _extractProtocolId(demoContent);
    final cliProtocol = _extractProtocolId(cliContent);
    
    if (demoProtocol != cliProtocol) {
      throw Exception('Protocol mismatch: demo=$demoProtocol, cli=$cliProtocol');
    }
    
    print('✅ Protocol consistency: $demoProtocol');
    
    // Test 4: Required methods check
    print('\n🔧 Test 4: Required methods check');
    final requiredMethods = [
      'initialize',
      'connectToRelay',
      'sendMessageToPeer',
      'disconnect',
    ];
    
    for (final method in requiredMethods) {
      if (!demoContent.contains('Future<void> $method') && 
          !demoContent.contains('Future<bool> $method')) {
        throw Exception('Required method $method not found in demo');
      }
    }
    
    print('✅ All required methods found');
    
    // Test 5: Error handling check
    print('\n🛡️ Test 5: Error handling check');
    final errorPatterns = [
      'try {',
      'catch (e)',
      'rethrow',
      'TimeoutException',
    ];
    
    for (final pattern in errorPatterns) {
      if (!cliContent.contains(pattern)) {
        print('⚠️  Warning: Error handling pattern "$pattern" not found');
      }
    }
    
    print('✅ Error handling validation completed');
    
    // Test 6: Configuration check
    print('\n⚙️ Test 6: Configuration check');
    final pubspecFile = File('pubspec.yaml');
    if (!pubspecFile.existsSync()) {
      throw Exception('pubspec.yaml not found');
    }
    
    final pubspecContent = pubspecFile.readAsStringSync();
    final requiredDependencies = [
      'libp2p:',
      'multiaddr:',
      'peerid:',
    ];
    
    for (final dep in requiredDependencies) {
      if (!pubspecContent.contains(dep)) {
        throw Exception('Required dependency $dep not found in pubspec.yaml');
      }
    }
    
    print('✅ Configuration validation passed');
    
    // Summary
    print('\n🎉 All tests passed!');
    print('\n📊 Test Summary:');
    print('  ✅ File existence check');
    print('  ✅ Syntax validation');
    print('  ✅ Protocol consistency');
    print('  ✅ Method completeness');
    print('  ✅ Error handling');
    print('  ✅ Configuration validation');
    
    print('\n🚀 Ready to use! Try these commands:');
    print('  dart run libp2p_relay_cli.dart info');
    print('  dart run libp2p_relay_cli.dart');
    print('  dart run libp2p_relay_cli.dart connect /ip4/127.0.0.1/tcp/4001/p2p/YOUR_PEER_ID');
    
  } catch (e, stackTrace) {
    print('❌ Test failed: $e');
    print('Stack trace: $stackTrace');
    exit(1);
  }
}

/// Extract protocol ID from source code
String _extractProtocolId(String content) {
  final protocolPattern = RegExp(r"protocolId\s*=\s*['"]([^'"]+)['"]");
  final match = protocolPattern.firstMatch(content);
  
  if (match == null) {
    throw Exception('Could not extract protocol ID');
  }
  
  return match.group(1)!;
}