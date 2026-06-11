import SwiftUI

struct AppletLynxViewRepresentable: UIViewRepresentable {
    let bundleURL: URL
    let session: AppletBridgeSession
    let lynxViewFactory: LynxViewFactory

    func makeUIView(context: Context) -> UIView {
        lynxViewFactory.create(bundleURL: bundleURL, bridgeSession: session)
    }

    func updateUIView(_ uiView: UIView, context: Context) {
    }
}
