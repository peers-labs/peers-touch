import SwiftUI

struct ProfileScreen: View {
    @State private var viewModel = ProfileViewModel()

    var body: some View {
        Text("Profile")
            .navigationTitle("Me")
    }
}
