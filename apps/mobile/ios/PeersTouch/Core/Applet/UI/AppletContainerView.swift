import SwiftUI

struct AppletContainerView: View {
    let appletId: String

    @State private var viewState: ViewState = .loading
    @State private var errorMessage: String?

    private let appletManager = Container.shared.appletManager
    private let lynxViewFactory = Container.shared.lynxViewFactory

    enum ViewState {
        case loading
        case running
        case error
    }

    var body: some View {
        Group {
            switch viewState {
            case .loading:
                AppletLoadingView(appletName: appletId)
            case .running:
                LynxViewRepresentable(appletId: appletId)
            case .error:
                AppletErrorView(
                    message: errorMessage ?? "Unknown error",
                    onRetry: { loadApplet() }
                )
            }
        }
        .task {
            loadApplet()
        }
    }

    private func loadApplet() {
        viewState = .loading
        do {
            let session = try appletManager.loadApplet(id: appletId)
            if session.state == .ready || session.state == .running {
                session.transition(to: .running)
                viewState = .running
            } else {
                errorMessage = "Applet is in \(session.state) state"
                viewState = .error
            }
        } catch {
            errorMessage = error.localizedDescription
            viewState = .error
        }
    }
}

struct LynxViewRepresentable: UIViewRepresentable {
    let appletId: String

    func makeUIView(context: Context) -> UIView {
        let container = Container.shared

        guard let info = container.appletManager.getAppletInfo(id: appletId),
              let bundlePath = container.appletBundleStorage.bundlePath(for: appletId),
              let session = container.appletManager.getApplet(id: appletId) else {
            let errorView = UIView()
            errorView.backgroundColor = .systemRed
            return errorView
        }

        let entryURL = bundlePath.appendingPathComponent(info.main)
        return container.lynxViewFactory.create(bundleURL: entryURL, bridgeSession: session)
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
