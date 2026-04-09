import SwiftUI

struct AppletLoadingView: View {
    let appletName: String

    var body: some View {
        VStack(spacing: Theme.spacingL) {
            ProgressView()
                .controlSize(.large)

            Text("Loading \(appletName)...")
                .font(Theme.typography.body)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}
