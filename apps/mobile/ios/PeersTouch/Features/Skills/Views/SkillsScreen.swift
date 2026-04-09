import SwiftUI

struct SkillsScreen: View {
    @State private var viewModel = SkillsViewModel()

    var body: some View {
        Text("Skills")
            .navigationTitle("Skills")
    }
}
