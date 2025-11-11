import 'package:peers_touch_storage/peers_touch_storage.dart';

/// Example runner to validate storage models and flows.
/// Run with: `dart run example/scenario_runner.dart`
Future<void> main() async {
  final driver = InMemoryStorageDriver();
  final storage = SimpleStorageService(driver: driver);

  print('--- CRM Scenario ---');
  await _crmScenario(storage);

  print('\n--- Orders Batch Import ---');
  await _ordersScenario(storage);

  print('\n--- Knowledge Base Query ---');
  await _knowledgeBaseScenario(storage);

  print('\n--- Chat Session (Document-only) ---');
  await _chatSessionScenario(storage);
}

Future<void> _crmScenario(SimpleStorageService storage) async {
  final customer = await storage.create('customers', {
    'name': 'Alice Corp',
    'status': 'active',
    'tags': ['VIP', 'B2B'],
    'contacts': [
      {'name': 'Alice', 'email': 'alice@corp.com'},
      {'name': 'Bob', 'email': 'bob@corp.com'},
    ],
    'address': {'city': 'Shanghai', 'country': 'CN'},
  });
  print('Created customer: ${customer['id']} ${customer['name']}');

  final page1 = await storage.query(
    'customers',
    const QueryOptions(page: 1, pageSize: 10, filter: {'status': 'active', 'tags': 'VIP'}),
  );
  print('Query page1 total=${page1.total}, items=${page1.items.length}');

  final updated = await storage.update('customers', customer['id'] as String, {
    'status': 'inactive',
  });
  print('Updated customer status to: ${updated['status']}');
}

Future<void> _ordersScenario(SimpleStorageService storage) async {
  final orders = List.generate(50, (i) => {
        'number': 'ORD-${1000 + i}',
        'status': i % 2 == 0 ? 'new' : 'processed',
        'items': [
          {'sku': 'SKU-${i}', 'qty': 1 + (i % 3)},
        ],
        'total': 99.0 + i,
      });
  final results = await storage.batchWrite('orders', orders);
  print('Imported ${results.length} orders.');

  final page2 = await storage.query(
    'orders',
    const QueryOptions(page: 2, pageSize: 10, filter: {'status': 'new'}),
  );
  print('Orders page2 (status=new): count=${page2.items.length} / total=${page2.total}');
}

Future<void> _knowledgeBaseScenario(SimpleStorageService storage) async {
  await storage.create('articles', {
    'title': 'Getting Started',
    'category': 'docs',
    'tags': ['guide', 'intro'],
    'content': 'Welcome to Peers-touch!'
  });
  await storage.create('articles', {
    'title': 'Troubleshooting',
    'category': 'docs',
    'tags': ['faq'],
    'content': 'Common issues and solutions.'
  });

  final res = await storage.query(
    'articles',
    const QueryOptions(page: 1, pageSize: 20, filter: {'tags': 'guide'}),
  );
  print('Docs with tag=guide: ${res.items.map((e) => e['title']).toList()}');
}

Future<void> _chatSessionScenario(SimpleStorageService storage) async {
  // Pure Document-based chat session
  final session = {
    'title': 'Project Discussion',
    'createdAt': DateTime.now().toIso8601String(),
    'messages': <Map<String, dynamic>>[
      {
        'content': 'Hello team!',
        'type': 'text',
        'timestamp': DateTime.now().toIso8601String(),
      },
      {
        'content': 'Let\'s plan milestones.',
        'type': 'text',
        'timestamp': DateTime.now().toIso8601String(),
      }
    ],
  };

  final saved = await storage.create('sessions', session);
  print('Saved session id=${saved['id']} messages=${(saved['messages'] as List).length}');

  final page = await storage.query(
    'sessions',
    const QueryOptions(page: 1, pageSize: 10),
  );
  print('Sessions total=${page.total}, first.title=${page.items.first['title']}');
}