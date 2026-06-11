import SwiftUI

struct AppletContainerView: View {
    let appletId: String
    @StateObject private var viewModel: AppletContainerViewModel
    private let lynxViewFactory: LynxViewFactory

    init(
        appletId: String,
        appletManager: AppletManager = Container.shared.appletManager,
        lynxViewFactory: LynxViewFactory = Container.shared.lynxViewFactory
    ) {
        self.appletId = appletId
        self.lynxViewFactory = lynxViewFactory
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
            case .running(let session, let bundleURL):
                if let loadConfig = session.manifest.iosLoadConfig {
                    AppletLynxViewRepresentable(
                        bundleURL: bundleURL.appendingPathComponent(loadConfig.entry),
                        session: session,
                        lynxViewFactory: lynxViewFactory
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
        case running(AppletBridgeSession, URL)
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
        do {
            let session = try appletManager.loadApplet(id: appletId)
            guard let bundleURL = appletManager.getBundleURL(appletId) else {
                state = .error("Applet \(appletId) bundle URL not found")
                return
            }
            session.transition(to: .running)
            state = .running(session, bundleURL)
        } catch {
            state = .error("Applet \(appletId) not found")
        }
    }

    func unload() {
        appletManager.unloadApplet(appletId)
    }
}
