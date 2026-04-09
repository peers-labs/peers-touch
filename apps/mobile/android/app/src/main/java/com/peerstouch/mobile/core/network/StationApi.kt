package com.peerstouch.mobile.core.network

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

interface StationApi {

    @POST("activitypub/sign-up")
    suspend fun signUp(@Body body: Map<String, String>): Response<Map<String, Any>>

    @POST("activitypub/login")
    suspend fun login(@Body credentials: Map<String, String>): Response<Map<String, Any>>

    @POST("activitypub/logout")
    suspend fun logout(): Response<Unit>

    @GET("activitypub/profile")
    suspend fun getProfile(): Response<Map<String, Any>>

    @POST("activitypub/profile")
    suspend fun updateProfile(@Body profile: Map<String, Any>): Response<Map<String, Any>>

    @GET("api/v1/session/verify")
    suspend fun verifySession(): Response<Map<String, Any>>

    @POST("friend-chat/session/create")
    suspend fun createFriendChatSession(@Body body: Map<String, Any>): Response<Map<String, Any>>

    @GET("friend-chat/sessions")
    suspend fun getFriendChatSessions(): Response<List<Map<String, Any>>>

    @POST("friend-chat/message/send")
    suspend fun sendFriendChatMessage(@Body message: Map<String, Any>): Response<Map<String, Any>>

    @GET("friend-chat/messages")
    suspend fun getFriendChatMessages(
        @Query("session_id") sessionId: String,
        @Query("limit") limit: Int? = null,
        @Query("before") before: String? = null
    ): Response<List<Map<String, Any>>>

    @POST("friend-chat/message/sync")
    suspend fun syncFriendChatMessages(@Body body: Map<String, Any>): Response<Map<String, Any>>

    @POST("friend-chat/message/ack")
    suspend fun ackFriendChatMessage(@Body body: Map<String, Any>): Response<Map<String, Any>>

    @POST("group-chat/create")
    suspend fun createGroupChat(@Body body: Map<String, Any>): Response<Map<String, Any>>

    @GET("group-chat/list")
    suspend fun getGroupChats(): Response<List<Map<String, Any>>>

    @GET("group-chat/info")
    suspend fun getGroupChatInfo(@Query("group_id") groupId: String): Response<Map<String, Any>>

    @POST("group-chat/message/send")
    suspend fun sendGroupChatMessage(@Body message: Map<String, Any>): Response<Map<String, Any>>

    @GET("group-chat/messages")
    suspend fun getGroupChatMessages(
        @Query("group_id") groupId: String,
        @Query("limit") limit: Int? = null,
        @Query("before") before: String? = null
    ): Response<List<Map<String, Any>>>

    @POST("group-chat/invite")
    suspend fun inviteToGroupChat(@Body body: Map<String, Any>): Response<Map<String, Any>>

    @POST("group-chat/join")
    suspend fun joinGroupChat(@Body body: Map<String, Any>): Response<Map<String, Any>>

    @POST("group-chat/leave")
    suspend fun leaveGroupChat(@Body body: Map<String, Any>): Response<Map<String, Any>>

    @GET("group-chat/members")
    suspend fun getGroupChatMembers(@Query("group_id") groupId: String): Response<List<Map<String, Any>>>

    @POST("ai-chat/provider/new")
    suspend fun createAiChatProvider(@Body body: Map<String, Any>): Response<Map<String, Any>>

    @GET("ai-chat/providers")
    suspend fun getAiChatProviders(): Response<List<Map<String, Any>>>

    @POST("ai-chat/session/new")
    suspend fun createAiChatSession(@Body body: Map<String, Any>): Response<Map<String, Any>>

    @GET("ai-chat/sessions")
    suspend fun getAiChatSessions(): Response<List<Map<String, Any>>>

    @GET("ai-chat/session/get")
    suspend fun getAiChatSession(@Query("session_id") sessionId: String): Response<Map<String, Any>>

    @GET("ai-chat/messages")
    suspend fun getAiChatMessages(
        @Query("session_id") sessionId: String,
        @Query("limit") limit: Int? = null,
        @Query("before") before: String? = null
    ): Response<List<Map<String, Any>>>

    @POST("ai-chat/chat/completions")
    @Streaming
    suspend fun aiChatCompletions(@Body body: Map<String, Any>): Response<okhttp3.ResponseBody>

    @GET("events/stream")
    @Streaming
    suspend fun getEventStream(): Response<okhttp3.ResponseBody>

    @POST("events/pull")
    suspend fun pullEvents(@Body body: Map<String, Any>): Response<List<Map<String, Any>>>

    @POST("events/ack")
    suspend fun ackEvents(@Body body: Map<String, Any>): Response<Map<String, Any>>

    @POST("api/v1/social/posts")
    suspend fun createPost(@Body body: Map<String, Any>): Response<Map<String, Any>>

    @GET("api/v1/social/posts/{id}")
    suspend fun getPost(@Path("id") postId: String): Response<Map<String, Any>>

    @GET("api/v1/social/timeline")
    suspend fun getTimeline(
        @Query("limit") limit: Int? = null,
        @Query("before") before: String? = null
    ): Response<List<Map<String, Any>>>

    @POST("api/v1/social/posts/{id}/like")
    suspend fun likePost(@Path("id") postId: String): Response<Map<String, Any>>

    @POST("api/v1/social/relationships/follow")
    suspend fun followUser(@Body body: Map<String, Any>): Response<Map<String, Any>>

    @GET("applets")
    suspend fun getApplets(): Response<List<Map<String, Any>>>

    @GET("applets/details")
    suspend fun getAppletDetails(@Query("id") appletId: String): Response<Map<String, Any>>

    @GET("applets/bundle")
    suspend fun getAppletBundle(@Query("id") appletId: String): Response<okhttp3.ResponseBody>

    @POST("sub-oss/upload")
    suspend fun uploadFile(@Body body: okhttp3.RequestBody): Response<Map<String, Any>>

    @GET("sub-oss/file")
    suspend fun getFile(@Query("key") key: String): Response<okhttp3.ResponseBody>

    @GET("launcher/search")
    suspend fun search(@Query("q") query: String): Response<Map<String, Any>>

    @GET("management/health")
    suspend fun healthCheck(): Response<Map<String, Any>>
}
