package handler

import (
	"net/http"

	"github.com/peers-touch/peers-touch-go/core/server"
)

// SetupRoutes 设置路由（不带wrapper）
func SetupRoutes(s server.Server) {
	// 身份相关路由
	s.Handle("/api/user/profile", http.HandlerFunc(GetUserProfile))
	s.Handle("/api/user", http.HandlerFunc(CreateUser))
	s.Handle("/api/user/profile", http.HandlerFunc(UpdateUserProfile))
	s.Handle("/api/user", http.HandlerFunc(DeleteUser))

	// 社交关系路由
	s.Handle("/api/social/follow", http.HandlerFunc(FollowUser))
	s.Handle("/api/social/unfollow", http.HandlerFunc(UnfollowUser))
	s.Handle("/api/social/followers", http.HandlerFunc(GetFollowers))
	s.Handle("/api/social/following", http.HandlerFunc(GetFollowing))
	s.Handle("/api/social/friends", http.HandlerFunc(GetFriends))

	// 即时消息路由
	s.Handle("/api/im/message", http.HandlerFunc(SendMessage))
	s.Handle("/api/im/messages", http.HandlerFunc(GetMessages))
	s.Handle("/api/im/chat", http.HandlerFunc(CreateChat))
	s.Handle("/api/im/chats", http.HandlerFunc(GetChats))
	s.Handle("/api/im/message", http.HandlerFunc(DeleteMessage))
	s.Handle("/api/im/message/read", http.HandlerFunc(MarkMessageRead))

	// 群组路由
	s.Handle("/api/group", http.HandlerFunc(CreateGroup))
	s.Handle("/api/group/{id}", http.HandlerFunc(GetGroup))
	s.Handle("/api/group/{id}", http.HandlerFunc(UpdateGroup))
	s.Handle("/api/group/{id}", http.HandlerFunc(DeleteGroup))
	s.Handle("/api/group/{id}/join", http.HandlerFunc(JoinGroup))
	s.Handle("/api/group/{id}/leave", http.HandlerFunc(LeaveGroup))
	s.Handle("/api/group/{id}/members", http.HandlerFunc(GetGroupMembers))

	// ActivityPub路由
	s.Handle("/.well-known/webfinger", http.HandlerFunc(WebFinger))
	s.Handle("/actor", http.HandlerFunc(GetActor))
	s.Handle("/inbox", http.HandlerFunc(GetInbox))
	s.Handle("/outbox", http.HandlerFunc(GetOutbox))
	s.Handle("/inbox", http.HandlerFunc(PostToInbox))
	s.Handle("/followers", http.HandlerFunc(GetFollowersAP))
	s.Handle("/following", http.HandlerFunc(GetFollowingAP))

	// 认证路由
	s.Handle("/api/auth/login", http.HandlerFunc(Login))
	s.Handle("/api/auth/register", http.HandlerFunc(Register))
	s.Handle("/api/auth/logout", http.HandlerFunc(Logout))
	s.Handle("/api/auth/refresh", http.HandlerFunc(RefreshToken))
	s.Handle("/api/auth/verify", http.HandlerFunc(VerifyToken))
	s.Handle("/api/auth/password", http.HandlerFunc(ChangePassword))

	// P2P网络路由
	s.Handle("/api/p2p/connect", http.HandlerFunc(ConnectPeer))
	s.Handle("/api/p2p/disconnect", http.HandlerFunc(DisconnectPeer))
	s.Handle("/api/p2p/peers", http.HandlerFunc(GetConnectedPeers))
	s.Handle("/api/p2p/message", http.HandlerFunc(SendMessageToPeer))
	s.Handle("/api/p2p/peer/{id}", http.HandlerFunc(GetPeerInfo))
	s.Handle("/api/p2p/broadcast", http.HandlerFunc(BroadcastMessage))

	// 初始化路由
	s.Handle("/api/init", http.HandlerFunc(InitHandler))
	s.Handle("/api/health", http.HandlerFunc(HealthCheck))
	s.Handle("/api/version", http.HandlerFunc(GetVersion))
	s.Handle("/api/status", http.HandlerFunc(GetStatus))
}

// SetupRoutesWithWrappers 设置带wrapper的路由
func SetupRoutesWithWrappers(s server.Server) {
	// 获取默认wrapper
	wrappers := GetDefaultWrappers()

	// 创建带wrapper的handler
	createHandler := func(handler http.HandlerFunc) http.Handler {
		return wrappers(handler)
	}

	// 设置带wrapper的路由
	s.Handle("/api/user/profile", createHandler(GetUserProfile))
	s.Handle("/api/user", createHandler(CreateUser))
	s.Handle("/api/user/profile", createHandler(UpdateUserProfile))
	s.Handle("/api/user", createHandler(DeleteUser))

	s.Handle("/api/social/follow", createHandler(FollowUser))
	s.Handle("/api/social/unfollow", createHandler(UnfollowUser))
	s.Handle("/api/social/followers", createHandler(GetFollowers))
	s.Handle("/api/social/following", createHandler(GetFollowing))
	s.Handle("/api/social/friends", createHandler(GetFriends))

	s.Handle("/api/im/message", createHandler(SendMessage))
	s.Handle("/api/im/messages", createHandler(GetMessages))
	s.Handle("/api/im/chat", createHandler(CreateChat))
	s.Handle("/api/im/chats", createHandler(GetChats))
	s.Handle("/api/im/message", createHandler(DeleteMessage))
	s.Handle("/api/im/message/read", createHandler(MarkMessageRead))

	s.Handle("/api/group", createHandler(CreateGroup))
	s.Handle("/api/group/{id}", createHandler(GetGroup))
	s.Handle("/api/group/{id}", createHandler(UpdateGroup))
	s.Handle("/api/group/{id}", createHandler(DeleteGroup))
	s.Handle("/api/group/{id}/join", createHandler(JoinGroup))
	s.Handle("/api/group/{id}/leave", createHandler(LeaveGroup))
	s.Handle("/api/group/{id}/members", createHandler(GetGroupMembers))

	s.Handle("/.well-known/webfinger", createHandler(WebFinger))
	s.Handle("/actor", createHandler(GetActor))
	s.Handle("/inbox", createHandler(GetInbox))
	s.Handle("/outbox", createHandler(GetOutbox))
	s.Handle("/inbox", createHandler(PostToInbox))
	s.Handle("/followers", createHandler(GetFollowersAP))
	s.Handle("/following", createHandler(GetFollowingAP))

	s.Handle("/api/auth/login", createHandler(Login))
	s.Handle("/api/auth/register", createHandler(Register))
	s.Handle("/api/auth/logout", createHandler(Logout))
	s.Handle("/api/auth/refresh", createHandler(RefreshToken))
	s.Handle("/api/auth/verify", createHandler(VerifyToken))
	s.Handle("/api/auth/password", createHandler(ChangePassword))

	s.Handle("/api/p2p/connect", createHandler(ConnectPeer))
	s.Handle("/api/p2p/disconnect", createHandler(DisconnectPeer))
	s.Handle("/api/p2p/peers", createHandler(GetConnectedPeers))
	s.Handle("/api/p2p/message", createHandler(SendMessageToPeer))
	s.Handle("/api/p2p/peer/{id}", createHandler(GetPeerInfo))
	s.Handle("/api/p2p/broadcast", createHandler(BroadcastMessage))

	s.Handle("/api/init", createHandler(InitHandler))
	s.Handle("/api/health", createHandler(HealthCheck))
	s.Handle("/api/version", createHandler(GetVersion))
	s.Handle("/api/status", createHandler(GetStatus))
}
