import SwiftUI

struct ChannelsScreen: View {
    @State private var viewModel = ChannelsViewModel()

    var body: some View {
        Text("Channels")
            .navigationTitle("Channels")
    }
}
