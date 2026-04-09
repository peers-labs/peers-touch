import Foundation

final class AuthInterceptor: @unchecked Sendable {
    private let preferenceStore: PreferenceStore

    init(preferenceStore: PreferenceStore) {
        self.preferenceStore = preferenceStore
    }

    func intercept(request: URLRequest) -> URLRequest {
        var mutableRequest = request
        if let token = preferenceStore.accessToken {
            mutableRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return mutableRequest
    }
}
