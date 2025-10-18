package handler

import (
	"net/http"

	"github.com/peers-touch/peers-touch-go/core/server"
)

// InitHandler 初始化处理器
func InitHandler(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现初始化处理器逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("InitHandler"))
}

// HealthCheck 健康检查
func HealthCheck(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现健康检查逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("HealthCheck"))
}

// GetVersion 获取版本信息
func GetVersion(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现获取版本信息逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("GetVersion"))
}

// GetStatus 获取状态信息
func GetStatus(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现获取状态信息逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("GetStatus"))
}

// SetupAllRoutes 设置所有路由（不带wrapper）
func SetupAllRoutes(s server.Server) {
	SetupRoutes(s)
}

// SetupAllRoutesWithWrappers 设置所有带wrapper的路由
func SetupAllRoutesWithWrappers(s server.Server) {
	SetupRoutesWithWrappers(s)
}

// GetHandlerFunctions 返回所有handler函数，用于测试或其他用途
func GetHandlerFunctions() map[string]interface{} {
	return map[string]interface{}{
		// 身份相关
		"GetUserProfile":    GetUserProfile,
		"CreateUser":        CreateUser,
		"UpdateUserProfile": UpdateUserProfile,
		"DeleteUser":        DeleteUser,

		// 社交关系
		"FollowUser":   FollowUser,
		"UnfollowUser": UnfollowUser,
		"GetFollowers": GetFollowers,
		"GetFollowing": GetFollowing,
		"GetFriends":   GetFriends,

		// 即时消息
		"SendMessage":     SendMessage,
		"GetMessages":     GetMessages,
		"CreateChat":      CreateChat,
		"GetChats":        GetChats,
		"DeleteMessage":   DeleteMessage,
		"MarkMessageRead": MarkMessageRead,

		// 群组
		"CreateGroup":     CreateGroup,
		"GetGroup":        GetGroup,
		"UpdateGroup":     UpdateGroup,
		"DeleteGroup":     DeleteGroup,
		"JoinGroup":       JoinGroup,
		"LeaveGroup":      LeaveGroup,
		"GetGroupMembers": GetGroupMembers,

		// ActivityPub
		"GetActor":       GetActor,
		"GetInbox":       GetInbox,
		"GetOutbox":      GetOutbox,
		"PostToInbox":    PostToInbox,
		"GetFollowersAP": GetFollowersAP,
		"GetFollowingAP": GetFollowingAP,
		"WebFinger":      WebFinger,

		// 认证
		"Login":          Login,
		"Register":       Register,
		"Logout":         Logout,
		"RefreshToken":   RefreshToken,
		"VerifyToken":    VerifyToken,
		"ChangePassword": ChangePassword,

		// P2P网络
		"ConnectPeer":       ConnectPeer,
		"DisconnectPeer":    DisconnectPeer,
		"GetConnectedPeers": GetConnectedPeers,
		"SendMessageToPeer": SendMessageToPeer,
		"GetPeerInfo":       GetPeerInfo,
		"BroadcastMessage":  BroadcastMessage,
	}
}

// GetWrapperFunctions 返回所有wrapper函数
func GetWrapperFunctions() map[string]interface{} {
	return map[string]interface{}{
		"GetAuthWrapper":           GetAuthWrapper,
		"GetLogWrapper":            GetLogWrapper,
		"GetRateLimitWrapper":      GetRateLimitWrapper,
		"GetCorsWrapper":           GetCorsWrapper,
		"GetRecoveryWrapper":       GetRecoveryWrapper,
		"CombineWrappers":          CombineWrappers,
		"GetDefaultWrappers":       GetDefaultWrappers,
		"GetAuthenticatedWrappers": GetAuthenticatedWrappers,
	}
}
