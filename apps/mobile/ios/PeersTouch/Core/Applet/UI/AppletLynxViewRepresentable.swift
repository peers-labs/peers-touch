import SwiftUI
import UIKit

final class AppletSurfaceCache: AppletSurfaceCacheHooks {
    typealias ViewFactory = (URL, AppletBridgeSession) -> UIView

    private struct CachedSurface {
        let view: UIView
        let session: AppletBridgeSession
        var bundleURL: URL
        var lastAccessedAt: Date
    }

    private var surfaces: [String: CachedSurface] = [:]

    func acquireSurface(
        instanceId: String,
        bundleURL: URL,
        session: AppletBridgeSession,
        factory: ViewFactory
    ) -> UIView {
        if var cached = surfaces[instanceId] {
            cached.bundleURL = bundleURL
            cached.lastAccessedAt = Date()
            cached.view.isHidden = false
            surfaces[instanceId] = cached
            return cached.view
        }

        let view = factory(bundleURL, session)
        view.isHidden = false
        surfaces[instanceId] = CachedSurface(
            view: view,
            session: session,
            bundleURL: bundleURL,
            lastAccessedAt: Date()
        )
        return view
    }

    func apply(_ command: AppletSurfaceCommand, instanceId: String) {
        let operation = { [weak self] in
            guard let self, let cached = self.surfaces[instanceId] else { return }
            switch command {
            case .show:
                cached.view.isHidden = false
            case .hide:
                cached.view.isHidden = true
            case .detach:
                cached.view.removeFromSuperview()
            case .destroy:
                cached.view.removeFromSuperview()
                self.surfaces.removeValue(forKey: instanceId)
            }
        }

        if Thread.isMainThread {
            operation()
        } else {
            DispatchQueue.main.async(execute: operation)
        }
    }

    func estimateMemory(instanceId: String) -> Int {
        guard let view = surfaces[instanceId]?.view else { return 0 }
        let area = max(view.bounds.width * view.bounds.height, 1)
        return Int(area * 4)
    }
}

struct AppletLynxViewRepresentable: UIViewRepresentable {
    let bundleURL: URL
    let session: AppletBridgeSession
    let lynxViewFactory: LynxViewFactory
    let surfaceCache: AppletSurfaceCache

    func makeUIView(context: Context) -> UIView {
        surfaceCache.acquireSurface(
            instanceId: session.instanceId,
            bundleURL: bundleURL,
            session: session
        ) { bundleURL, session in
            lynxViewFactory.create(bundleURL: bundleURL, bridgeSession: session)
        }
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        uiView.isHidden = false
    }
}
