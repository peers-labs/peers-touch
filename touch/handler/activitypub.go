package handler

import (
	"net/http"
)

// GetActor 获取Actor信息
func GetActor(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现获取Actor信息逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("GetActor"))
}

// GetInbox 获取收件箱
func GetInbox(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现获取收件箱逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("GetInbox"))
}

// GetOutbox 获取发件箱
func GetOutbox(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现获取发件箱逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("GetOutbox"))
}

// PostToInbox 发送到收件箱
func PostToInbox(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现发送到收件箱逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("PostToInbox"))
}

// GetFollowersAP 获取关注者列表
func GetFollowersAP(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现获取关注者列表逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("GetFollowersAP"))
}

// GetFollowingAP 获取正在关注的列表
func GetFollowingAP(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现获取正在关注的列表逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("GetFollowingAP"))
}

// WebFinger WebFinger协议
func WebFinger(w http.ResponseWriter, r *http.Request) {
	// TODO: 实现WebFinger协议逻辑
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("WebFinger"))
}