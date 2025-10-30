import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'package:peers_touch_mobile/pages/chat/chat_page.dart';
import 'package:peers_touch_mobile/pages/photo/photo_page.dart';
import 'package:peers_touch_mobile/pages/me/me_home.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

import 'package:peers_touch_mobile/components/navigation/bottom_nav_bar.dart';
import 'package:peers_touch_mobile/components/common/floating_action_ball.dart';

import 'package:get/get.dart';

import 'l10n/app_localizations.dart';
import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:peers_touch_mobile/utils/floating_layout_manager.dart';
import 'package:peers_touch_mobile/components/sync_status_bar.dart';

void main() async {
  // Ensure Flutter is initialized
  WidgetsFlutterBinding.ensureInitialized();

  // Register the method channel early
  const MethodChannel platform = MethodChannel('samples.flutter.dev/storage');

  // Set up a method call handler to ensure the channel is registered
  platform.setMethodCallHandler((call) async {
    // This is just to ensure the channel is registered
    return null;
  });

  // Try to make a call to initialize the channel, but ignore errors
  try {
    await platform.invokeMethod('getFreeDiskSpace').catchError((error) {
      // Ignore errors during initialization
      appLogger.debug('Method channel initialization error (expected): $error');
    });
  } catch (e) {
    // Ignore errors during initialization
    appLogger.debug('Method channel initialization exception (expected): $e');
  }

  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return GetMaterialApp(
      // Changed from MaterialApp
      title: 'Peers Touch',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
      ),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('en'), // English
        Locale('es'), // Spanish
        Locale('zh'), // Chinese
      ],
      initialRoute: '/',
      getPages: [GetPage(name: '/', page: () => const MainScreen())],
    );
  }
}

// You can keep MyHomePage for reference or remove it

class MyHomePage extends StatefulWidget {
  const MyHomePage({super.key, required this.title});

  // This widget is the home page of your application. It is stateful, meaning
  // that it has a State object (defined below) that contains fields that affect
  // how it looks.

  // This class is the configuration for the state. It holds the values (in this
  // case the title) provided by the parent (in this case the App widget) and
  // used by the build method of the State. Fields in a Widget subclass are
  // always marked "final".

  final String title;

  @override
  State<MyHomePage> createState() => _MyHomePageState();
}

class _MyHomePageState extends State<MyHomePage> {
  int _counter = 0;

  void _incrementCounter() {
    setState(() {
      // This call to setState tells the Flutter framework that something has
      // changed in this State, which causes it to rerun the build method below
      // so that the display can reflect the updated values. If we changed
      // _counter without calling setState(), then the build method would not be
      // called again, and so nothing would appear to happen.
      _counter++;
    });
  }

  @override
  Widget build(BuildContext context) {
    // This method is rerun every time setState is called, for instance as done
    // by the _incrementCounter method above.
    //
    // The Flutter framework has been optimized to make rerunning build methods
    // fast, so that you can just rebuild anything that needs updating rather
    // than having to individually change instances of widgets.
    return Scaffold(
      appBar: AppBar(
        // TRY THIS: Try changing the color here to a specific color (to
        // Colors.amber, perhaps?) and trigger a hot reload to see the AppBar
        // change color while the other colors stay the same.
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
        // Here we take the value from the MyHomePage object that was created by
        // the App.build method, and use it to set our appbar title.
        title: Text(widget.title),
      ),
      body: Center(
        // Center is a layout widget. It takes a single child and positions it
        // in the middle of the parent.
        child: Column(
          // Column is also a layout widget. It takes a list of children and
          // arranges them vertically. By default, it sizes itself to fit its
          // children horizontally, and tries to be as tall as its parent.
          //
          // Column has various properties to control how it sizes itself and
          // how it positions its children. Here we use mainAxisAlignment to
          // center the children vertically; the main axis here is the vertical
          // axis because Columns are vertical (the cross axis would be
          // horizontal).
          //
          // TRY THIS: Invoke "debug painting" (choose the "Toggle Debug Paint"
          // action in the IDE, or press "p" in the console), to see the
          // wireframe for each widget.
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            const Text('You have pushed the button this many times:'),
            Text(
              '$_counter',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _incrementCounter,
        tooltip: 'Increment',
        child: const Icon(Icons.add),
      ), // This trailing comma makes auto-formatting nicer for build methods.
    );
  }
}

class MainScreen extends StatefulWidget {
  const MainScreen({super.key});

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  int _currentIndex = 0;
  List<FloatingActionOption> _currentOptions = [];
  final GlobalKey<FloatingActionBallState> _floatingActionBallKey =
      GlobalKey<FloatingActionBallState>();

  final List<Widget> _pages = [
    const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('Home'),
          SizedBox(height: 20),
          ElevatedButton(
            onPressed: null, // Will be set in build method
            child: Text('Test Network Connection'),
          ),
        ],
      ),
    ),
    const ChatPage(),
    PhotoPage(),
    MeHomePage(),
  ];

  @override
  void initState() {
    super.initState();
    // Initialize ControllerManager to ensure all controllers are ready
    ControllerManager();
  }

  void _updateOptions() {
    final currentPage = _pages[_currentIndex];
    setState(() {
      _currentOptions = _getPageOptions(currentPage);
    });
  }

  List<FloatingActionOption> _getPageOptions(Widget page) {
    if (page is ChatPage) return ChatPage.actionOptions;
    if (page is PhotoPage) return PhotoPage.actionOptions;
    if (page is MeHomePage) return MeHomePage.actionOptions;
    return [];
  }

  String? _getCurrentPageKey() {
    switch (_currentIndex) {
      case 2: // PhotoPage index
        return 'photo_page';
      default:
        return null;
    }
  }

  void _handleOutsideTap() {
    final floatingActionBallState = _floatingActionBallKey.currentState;
    if (floatingActionBallState != null && floatingActionBallState.isExpanded) {
      floatingActionBallState.collapse();
    }
  }

  @override
  Widget build(BuildContext context) {
    // Create a modified home page with a working button
    final List<Widget> modifiedPages = List.from(_pages);
    if (_currentIndex == 0) {
      modifiedPages[0] = Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('Home'),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () => Get.toNamed('/network-test'),
              child: const Text('Test Network Connection'),
            ),
          ],
        ),
      );
    }

    return GestureDetector(
      onTap: _handleOutsideTap,
      behavior: HitTestBehavior.translucent,
      child: Scaffold(
        body: Stack(
          children: [
            modifiedPages[_currentIndex],
            // Sync status bar at the top
            Positioned(top: 0, left: 0, right: 0, child: SyncStatusBar()),
            if (_currentOptions.isNotEmpty)
              FloatingLayoutManager.positionedFloatingActionBall(
                context: context,
                key: ValueKey(_currentIndex), // Force rebuild on page change
                options: _currentOptions,
                globalKey: _floatingActionBallKey,
              ),
            if (_getCurrentPageKey() != null)
              FloatingLayoutManager.positionedScrollToTopButton(
                context: context,
                pageKey: _getCurrentPageKey()!,
                hasFloatingOptions: _currentOptions.isNotEmpty,
                optionsCount: _currentOptions.length,
              ),
          ],
        ),
        bottomNavigationBar: BottomNavBar(
          currentIndex: _currentIndex,
          onTap:
              (index) => setState(() {
                _currentIndex = index;
                _updateOptions();
              }),
          onOutsideTap: _handleOutsideTap,
        ),
      ),
    );
  }
}
