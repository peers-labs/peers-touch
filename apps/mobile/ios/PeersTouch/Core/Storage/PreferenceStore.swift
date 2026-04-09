import Foundation

final class PreferenceStore: @unchecked Sendable {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var accessToken: String? {
        get { defaults.string(forKey: Keys.accessToken) }
        set { defaults.set(newValue, forKey: Keys.accessToken) }
    }

    var refreshToken: String? {
        get { defaults.string(forKey: Keys.refreshToken) }
        set { defaults.set(newValue, forKey: Keys.refreshToken) }
    }

    var stationBaseURL: URL {
        get {
            if let urlString = defaults.string(forKey: Keys.stationBaseURL),
               let url = URL(string: urlString) {
                return url
            }
            return URL(string: "http://localhost:3000")!
        }
        set { defaults.set(newValue.absoluteString, forKey: Keys.stationBaseURL) }
    }

    var isOnboarded: Bool {
        get { defaults.bool(forKey: Keys.isOnboarded) }
        set { defaults.set(newValue, forKey: Keys.isOnboarded) }
    }

    var userId: String? {
        get { defaults.string(forKey: Keys.userId) }
        set { defaults.set(newValue, forKey: Keys.userId) }
    }

    func clear() {
        Keys.allKeys.forEach { defaults.removeObject(forKey: $0) }
    }
}

private extension PreferenceStore {
    enum Keys {
        static let accessToken = "pt_access_token"
        static let refreshToken = "pt_refresh_token"
        static let stationBaseURL = "pt_station_base_url"
        static let isOnboarded = "pt_is_onboarded"
        static let userId = "pt_user_id"

        static let allKeys = [
            accessToken, refreshToken, stationBaseURL, isOnboarded, userId
        ]
    }
}
