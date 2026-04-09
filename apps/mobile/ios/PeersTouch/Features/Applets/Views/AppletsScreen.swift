import SwiftUI

struct AppletsScreen: View {
    @State private var viewModel = AppletsViewModel()

    var body: some View {
        Text("Applets")
            .navigationTitle("Applets")
    }
}
