import SwiftUI

struct MemoryScreen: View {
    @State private var viewModel = MemoryViewModel()

    var body: some View {
        Text("Memory")
            .navigationTitle("Memory")
    }
}
