import Foundation

enum StationEndpoint: Sendable {

    case signUp
    case login
    case logout
    case getProfile
    case updateProfile
    case verifySession
    case getPublicProfile(actor: String)
    case getActorBasicInfo(id: String)
    case listActors
    case searchActors(query: String)

    case createFriendChatSession
    case getFriendChatSessions
    case sendFriendMessage
    case getFriendMessages(sessionId: String)
    case syncFriendMessages
    case ackFriendMessage

    case createGroup
    case listGroups
    case getGroupInfo(groupId: String)
    case sendGroupMessage
    case getGroupMessages(groupId: String)
    case inviteToGroup
    case joinGroup
    case leaveGroup
    case getGroupMembers(groupId: String)

    case createAIProvider
    case listAIProviders
    case createAISession
    case listAISessions
    case getAISession(sessionId: String)
    case listAIMessages(sessionId: String)
    case aiCompletions

    case eventStream
    case pullEvents
    case ackEvents

    case createPost
    case getPost(id: String)
    case getTimeline
    case likePost(id: String)
    case followUser

    case listApplets
    case getAppletDetails(appletId: String)
    case getAppletBundle(appletId: String)

    case uploadFile
    case getFile(key: String)

    case search(query: String)

    case health

    var path: String {
        switch self {
        case .signUp:
            "/activitypub/sign-up"
        case .login:
            "/activitypub/login"
        case .logout:
            "/activitypub/logout"
        case .getProfile:
            "/activitypub/profile"
        case .updateProfile:
            "/activitypub/profile"
        case .verifySession:
            "/api/v1/session/verify"
        case .getPublicProfile(let actor):
            "/activitypub/\(actor)/profile"
        case .getActorBasicInfo(let id):
            "/activitypub/actors/\(id)/basic-info"
        case .listActors:
            "/activitypub/list"
        case .searchActors:
            "/activitypub/search"

        case .createFriendChatSession:
            "/friend-chat/session/create"
        case .getFriendChatSessions:
            "/friend-chat/sessions"
        case .sendFriendMessage:
            "/friend-chat/message/send"
        case .getFriendMessages:
            "/friend-chat/messages"
        case .syncFriendMessages:
            "/friend-chat/message/sync"
        case .ackFriendMessage:
            "/friend-chat/message/ack"

        case .createGroup:
            "/group-chat/create"
        case .listGroups:
            "/group-chat/list"
        case .getGroupInfo:
            "/group-chat/info"
        case .sendGroupMessage:
            "/group-chat/message/send"
        case .getGroupMessages:
            "/group-chat/messages"
        case .inviteToGroup:
            "/group-chat/invite"
        case .joinGroup:
            "/group-chat/join"
        case .leaveGroup:
            "/group-chat/leave"
        case .getGroupMembers:
            "/group-chat/members"

        case .createAIProvider:
            "/ai-chat/provider/new"
        case .listAIProviders:
            "/ai-chat/providers"
        case .createAISession:
            "/ai-chat/session/new"
        case .listAISessions:
            "/ai-chat/sessions"
        case .getAISession:
            "/ai-chat/session/get"
        case .listAIMessages:
            "/ai-chat/messages"
        case .aiCompletions:
            "/ai-chat/chat/completions"

        case .eventStream:
            "/events/stream"
        case .pullEvents:
            "/events/pull"
        case .ackEvents:
            "/events/ack"

        case .createPost:
            "/api/v1/social/posts"
        case .getPost(let id):
            "/api/v1/social/posts/\(id)"
        case .getTimeline:
            "/api/v1/social/timeline"
        case .likePost(let id):
            "/api/v1/social/posts/\(id)/like"
        case .followUser:
            "/api/v1/social/relationships/follow"

        case .listApplets:
            "/api/v1/applets"
        case .getAppletDetails:
            "/api/v1/applets/details"
        case .getAppletBundle:
            "/api/v1/applets/bundle"

        case .uploadFile:
            "/sub-oss/upload"
        case .getFile:
            "/sub-oss/file"

        case .search:
            "/launcher/search"

        case .health:
            "/management/health"
        }
    }

    var method: HTTPMethod {
        switch self {
        case .signUp, .login, .logout, .updateProfile,
             .createFriendChatSession, .sendFriendMessage, .syncFriendMessages, .ackFriendMessage,
             .createGroup, .sendGroupMessage, .inviteToGroup, .joinGroup, .leaveGroup,
             .createAIProvider, .createAISession, .aiCompletions,
             .pullEvents, .ackEvents,
             .createPost, .likePost, .followUser,
             .uploadFile:
            .post
        default:
            .get
        }
    }
}
