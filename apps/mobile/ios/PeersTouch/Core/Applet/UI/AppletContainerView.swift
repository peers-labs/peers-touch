import SwiftUI

struct AppletContainerView: View {
    let appletId: String
    @StateObject private var viewModel: AppletContainerViewModel

    init(appletId: String, appletManager: AppletManager) {
        self.appletId = appletId
        _viewModel = StateObject(wrappedValue: AppletContainerViewModel(
            appletId: appletId,
            appletManager: appletManager
        ))
    }

    var body: some View {
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView("Loading applet...")
            case .running(let session):
                if let loadConfig = session.manifest.iosLoadConfig {
                    AppletLynxViewRepresentable(
                        bundleUrl: loadConfig.entry,
                        session: session
                    )
                } else {
                    errorView("No iOS load config for applet \(appletId)")
                }
            case .error(let message):
                errorView(message)
            }
        }
        .onAppear { viewModel.load() }
        .onDisappear { viewModel.unload() }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundColor(.orange)
            Text(message)
                .font(.body)
                .multilineTextAlignment(.center)
                .padding()
        }
    }
}

@MainActor
final class AppletContainerViewModel: ObservableObject {
    enum ContainerState {
        case loading
        case running(AppletBridgeSession)
        case error(String)
    }

    @Published var state: ContainerState = .loading

    private let appletId: String
    private let appletManager: AppletManager

    init(appletId: String, appletManager: AppletManager) {
        self.appletId = appletId
        self.appletManager = appletManager
    }

    func load() {
        guard let session = appletManager.getApplet(appletId) else {
            state = .error("Applet \(appletId) not found")
            return
        }
        session.transition(to: .running)
        state = .running(session)
    }

    func unload() {
        appletManager.unloadApplet(appletId)
    }
}
