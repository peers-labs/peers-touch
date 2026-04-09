import SwiftUI

struct AppTabView: View {
    @Environment(Router.self) private var router
    @State private var selectedTab: Tab = .home

    enum Tab: String, CaseIterable {
        case home, im, ai, settings
        
        var icon: String {
            switch self {
            case .home: return "house.fill"
            case .im: return "message.fill"
            case .ai: return "sparkles"
            case .settings: return "gearshape.fill"
            }
        }
        
        var label: String {
            switch self {
            case .home: return "首页"
            case .im: return "消息"
            case .ai: return "AI助手"
            case .settings: return "设置"
            }
        }
    }

    var body: some View {
        @Bindable var router = router
        TabView(selection: $selectedTab) {
            NavigationStack(path: $router.path) {
                HomeScreen()
                    .navigationDestination(for: Route.self) { route in
                        destinationView(for: route)
                    }
            }
            .tag(Tab.home)
            .tabItem {
                Image(systemName: Tab.home.icon)
                Text(Tab.home.label)
            }

            NavigationStack {
                IMChatScreen()
                    .navigationDestination(for: Route.self) { route in
                        destinationView(for: route)
                    }
            }
            .tag(Tab.im)
            .tabItem {
                Image(systemName: Tab.im.icon)
                Text(Tab.im.label)
            }

            NavigationStack {
                AIChatScreen()
                    .navigationDestination(for: Route.self) { route in
                        destinationView(for: route)
                    }
            }
            .tag(Tab.ai)
            .tabItem {
                Image(systemName: Tab.ai.icon)
                Text(Tab.ai.label)
            }

            NavigationStack {
                SettingsScreen()
                    .navigationDestination(for: Route.self) { route in
                        destinationView(for: route)
                    }
            }
            .tag(Tab.settings)
            .tabItem {
                Image(systemName: Tab.settings.icon)
                Text(Tab.settings.label)
            }
        }
        .tint(Color(red: 0.420, green: 0.275, blue: 0.757))
    }

    @ViewBuilder
    func destinationView(for route: Route) -> some View {
        switch route {
        case .imChat(let id):
            IMChatDetailScreen(chatId: id)
        case .imAddFriend:
            IMAddFriendScreen()
        case .aiChat:
            AIChatScreen()
        case .login:
            LoginScreen()
        case .appletDetail(let id):
            AppletContainerView(appletId: id)
        case .chat:
            IMChatScreen()
        }
    }
}
