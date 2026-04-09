import SwiftUI

struct SearchScreen: View {
    @State private var viewModel = SearchViewModel()

    var body: some View {
        Text("Search")
            .navigationTitle("Search")
    }
}
