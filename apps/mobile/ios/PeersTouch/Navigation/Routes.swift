import Foundation

enum Route: Hashable {
    case chat
    case imChat(id: String)
    case imAddFriend
    case aiChat
    case login
    case appletDetail(id: String)
}
