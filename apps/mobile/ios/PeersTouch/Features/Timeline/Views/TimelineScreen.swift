import SwiftUI

struct TimelineScreen: View {
    @State private var viewModel = TimelineViewModel()

    var body: some View {
        Text("Timeline")
            .navigationTitle("Timeline")
    }
}
