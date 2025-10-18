package handler

import (
	"net/http"
)

// FollowUser 关注用户
func FollowUser(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现关注用户逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("FollowUser"))
}

// UnfollowUser 取消关注
func UnfollowUser(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现取消关注逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("UnfollowUser"))
}

// GetFollowers 获取粉丝列表
func GetFollowers(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现获取粉丝列表逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("GetFollowers"))
}

// GetFollowing 获取关注列表
func GetFollowing(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现获取关注列表逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("GetFollowing"))
}

// GetFriends 获取好友列表（互相关注）
func GetFriends(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现获取好友列表逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("GetFriends"))
}