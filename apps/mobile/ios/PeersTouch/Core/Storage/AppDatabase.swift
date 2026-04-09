import Foundation
import SwiftData

final class AppDatabase: Sendable {
    let modelContainer: ModelContainer

    init() {
        let schema = Schema([])
        let configuration = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false
        )
        do {
            self.modelContainer = try ModelContainer(
                for: schema,
                configurations: [configuration]
            )
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }
    }

    @MainActor
    var modelContext: ModelContext {
        modelContainer.mainContext
    }
}
