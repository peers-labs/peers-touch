import SwiftUI

struct AppletErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: Theme.spacingXL) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 48))
                .foregroundStyle(.red)

            VStack(spacing: Theme.spacingS) {
                Text("Applet Error")
                    .font(Theme.typography.title3)

                Text(message)
                    .font(Theme.typography.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Theme.spacingXL)
            }

            Button(action: onRetry) {
                Text("Retry")
                    .font(Theme.typography.headline)
                    .frame(minWidth: 120)
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}
