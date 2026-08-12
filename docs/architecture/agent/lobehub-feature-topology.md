# LobeHub Chat Agent — Exhaustive Feature Topology

> **Status**: active
> **Created**: 2026-08-12
> **Purpose**: Complete L1→L4+ feature tree grounded in LobeHub source code (`external/lobehub/src/`).
> Use this as the basis for Peers-Touch capability scoping: mark each node `adopt` / `adapt` / `defer` / `reject`.

---

## L1: store/ — Core Business Logic

### L2: store/chat — Conversation Engine

#### L3: slices/agentRun — Agent Run Engine

##### L4: entries/ — Run Entry Points
- `sendMessage` — Main send entry (topic auto-create, hetero/gateway/client dispatch)
- `resolveExistingTopic` — Topic resolution

##### L4: conversationControl — Run Controls
- `stopGenerateMessage` — Stop generation
- `cancelSendMessageInServer` — Cancel server-side message
- `clearSendMessageError` — Clear send error
- `switchMessageBranch` — Switch message branch
- `approveToolCalling` — Approve tool call
- `submitToolInteraction` — Submit tool interaction
- `skipToolInteraction` — Skip tool interaction
- `cancelToolInteraction` — Cancel tool interaction
- `rejectToolCalling` — Reject tool call
- `rejectAndContinueToolCalling` — Reject and continue
- `submitHeteroIntervention` — Submit heterogeneous intervention
- `setInterventionDraft` — Set intervention draft
- `setInterventionAnswers` — Set intervention answers

##### L4: commandBus/ — Command Bus
- `handlers.ts` — Command handlers
- `parseCommands.ts` — Command parsing
- `editorDataHelpers.ts` — Editor data helpers

##### L4: dispatch/ — Agent Dispatchers
- `agentDispatcher.ts` — Agent dispatch
- `nonHeteroSubAgentDispatcher.ts` — Non-hetero sub-agent dispatch

##### L4: lifecycle/ — Run Lifecycle
- `buildRunLifecycle.ts` — Build run lifecycle
- `agentSignalBridge.ts` — Agent signal bridge
- `snapshotWorkingDirGit.ts` — Working dir git snapshot

##### L4: state/ — Runtime State
- `memory.ts` — Runtime memory state
- `streamingStates.ts` — Streaming state management

##### L4: transports/client/ — Client Transport
- `clientToolExecution.ts` — Client tool execution
- `localSystemToolSnapshots.ts` — Local system tool snapshots
- `streamingExecutor.ts` — Streaming executor

##### L4: transports/gateway/ — Gateway Transport
- `gateway.ts` — Gateway main logic
- `gatewayEventHandler.ts` — Gateway event handler
- `gatewayEventRouter.ts` — Gateway event router
- `gatewayMemberStreamHandler.ts` — Gateway member stream handler

##### L4: transports/hetero/ — Heterogeneous Transport
- `heterogeneousAgentExecutor.ts` — Hetero agent executor
- `heteroResume.ts` — Hetero resume
- `messageWriteBatcher.ts` — Message write batcher
- `pendingCreateLedger.ts` — Pending create ledger
- `resolveQuotaAccountEnv.ts` — Quota account env resolution
- `resumeReplay.ts` — Resume replay
- `sessionEnv.ts` — Session env

#### L3: slices/aiAgent — AI Agent Orchestration
- `internal_cleanupAgentOperation` — Cleanup agent operation
- `internal_handleAgentError` — Handle agent error
- `internal_handleAgentStreamEvent` — Handle agent stream event
- `internal_handleHumanIntervention` — Handle human intervention
- `sendGroupMessage` — Send group message
- `getGroupOrchestrationCallbacks` — Get group orchestration callbacks
- `triggerSpeak` / `triggerBroadcast` / `triggerDelegate` — Multi-agent orchestration
- `triggerExecuteTask` / `triggerExecuteTasks` — Task execution triggers
- `internal_execGroupOrchestration` — Execute group orchestration
- `useEnablePollingTaskStatus` — Poll task status

#### L3: slices/message — Message Management

##### L4: actions/
- `addAIMessage` / `addUserMessage` — Add messages
- `deleteAssistantMessage` / `deleteMessage` / `deleteDBMessage` / `deleteToolMessage` — Delete messages
- `clearMessage` — Clear all messages
- `copyMessage` — Copy message
- `toggleMessageEditing` — Toggle editing
- `updateMessageInput` — Update input
- `modifyMessageContent` — Modify content
- `internal_dispatchMessage` — Dispatch
- `internal_traceMessage` — Trace
- Optimistic update actions
- Query actions
- Runtime state actions

##### L4: selectors/
- `currentDisplayChatKey` / `getDisplayMessageById` — Display selectors
- `currentDbChatKey` / `getDbMessageByToolCallId` — DB selectors
- `selectActivatedToolIdsFromMessages` — Active tool IDs
- `selectActivatedSkillsFromMessages` — Active skills
- `selectTodosFromMessages` / `selectCurrentTurnTodosFromMessages` — Todo extraction
- `chatSelectors` / `messageStateSelectors` — Aggregate selectors

#### L3: slices/operation — Operation Management
- `startOperation` — Start operation
- `updateOperationMetadata` / `updateOperationStatus` / `updateOperationProgress` — Update
- `getOperationAbortSignal` — Get abort signal
- `onOperationCancel` / `cancelOperation` / `cancelOperations` — Cancel
- `failOperation` — Fail operation
- Types: `OperationType`, `OperationStatus`, `OperationContext`, `Operation`, `QueuedMessage`, `QueuedFile`

#### L3: slices/builtinTool — Built-in Tools
- `python` — Python code interpreter execution
- `updateInterpreterFileItem` — Update interpreter file
- `uploadInterpreterFiles` — Upload interpreter files
- `useFetchInterpreterFileItem` — Fetch interpreter file
- `togglePageContent` — Toggle page content
- `triggerSearchAgain` — Trigger re-search

#### L3: slices/plugin — Plugin Invocation
- `invokeBuiltinTool` — Invoke built-in tool
- `invokeComposioTypePlugin` — Invoke Composio plugin
- `invokeLobehubSkillTypePlugin` — Invoke LobeHub Skill plugin
- `invokeMCPTypePlugin` — Invoke MCP plugin
- `internal_invokeRemoteToolPlugin` — Invoke remote tool
- `reInvokeToolMessage` — Re-invoke tool message
- `createAssistantMessageByPlugin` — Create message via plugin

#### L3: slices/portal — Portal / Side Panel
- Navigation: `clearPortalStack`, `goBack`, `goHome`, `popPortalView`
- Open: `openAgentDetail`, `openDocument`, `openFilePreview`, `openLocalFile`
- Open: `openAcceptance`, `openAcceptanceCheck`, `openMessageDetail`, `openNotebook`, `openTaskDetail`
- Open: `openTopicCommentThread`, `openTopicComments`
- Close: `closeDocument`, `closeFilePreview`, `closeLocalFile`, `closeLocalFileTab`
- Close: `closeLeftLocalFileTabs`, `closeOtherLocalFileTabs`, `closeRightLocalFileTabs`
- Close: `closeMessageDetail`, `closeNotebook`, `closeTaskDetail`, `closeToolUI`
- Local file: `setActiveLocalFile`, `setLocalFileBuffer`, `saveLocalFile`

#### L3: slices/thread — Thread
- `createThread` — Create thread

#### L3: slices/topic — Topic Management
- `updateTopicModel` / `updateTopicStatus`
- `useFetchTopicLinkedPullRequest` / `useFetchTopics` / `useFetchAgentTopicsView` / `useSearchTopics`
- `removeGroupTopics`
- `internal_replaceTopicId` / `internal_updateTopicLinkedPullRequest` / `internal_updateTopics`

#### L3: slices/translate — Translation
- `updateMessageTranslate`

#### L3: slices/tts — Text-to-Speech
- TTS action handlers

#### L3: slices/forward — Message Forward
- `forwardMessages` / `forwardTopic`

#### L3: agents/ — Client Runtime

##### L4: transports/
- `buildClientRuntimeHost.ts` — Build client runtime host
- `ClientCompressionTransport.ts` — Compression transport
- `ClientContextBuilder.ts` — Context builder
- `ClientLLMTransport.ts` — LLM transport
- `ClientMessageTransport.ts` — Message transport
- `ClientRuntimeStreamSink.ts` — Runtime stream sink
- `ClientSubAgentTransport.ts` — Sub-agent transport
- `ClientToolTransport.ts` — Tool transport
- `createClientRuntimeExecutors.ts` — Create runtime executors

##### L4: GroupOrchestration/
- `createGroupOrchestrationExecutors.ts` — Create group orchestration executors

##### L4: Other
- `StreamingHandler.ts` — Stream handler
- `registerClientWorkFromIntent.ts` — Register work from intent

---

### L2: store/agent — Agent Configuration

#### L3: slices/agent — Core Agent Operations
- `createAgent` / `setActiveAgentId` / `transferAgent`
- `toggleAgentPlugin` / `setAgentPinned` / `toggleAgentPinned`
- `updateAgentChatConfig` / `updateAgentChatConfigById`
- `updateAgentConfig` / `updateAgentConfigById`
- `appendStreamingSystemRole` / `finishStreamingSystemRole` / `startStreamingSystemRole`

#### L3: slices/bot — Bot Provider (External Platform Integration)
- `createBotProvider` / `connectBot` / `testConnection`
- `lineFetchBotInfo` / `refreshBotRuntimeStatus` / `triggerRefreshAllBotStatuses`
- `internal_refreshBotProviders` / `updateBotProvider`
- `useFetchBotProviders` / `useFetchPlatformDefinitions`

#### L3: slices/builtin — Built-in Agents
- `refreshBuiltinAgent` / `useInitBuiltinAgent`

#### L3: slices/knowledge — Knowledge Binding
- `addFilesToAgent` / `addKnowledgeBaseToAgent`
- `internal_refreshAgentKnowledge`
- `removeFileFromAgent` / `removeKnowledgeBaseFromAgent`
- `toggleFile` / `toggleKnowledgeBase`
- `useFetchFilesAndKnowledgeBases`

#### L3: slices/plugin — Agent Plugin Toggle
- `removePlugin` / `togglePlugin` / `setPluginMode`

#### L3: selectors/
- `agentSelectors` / `agentByIdSelectors` / `agentChatConfigSelectors` / `chatConfigByIdSelectors` / `builtinAgentSelectors`

---

### L2: store/aiInfra — AI Infrastructure

#### L3: slices/aiModel — AI Model Management
- `batchToggleAiModels` / `batchUpdateAiModels` / `clearModelsByProvider` / `clearRemoteModels`
- `createNewAiModel` / `fetchRemoteModelList` / `refreshAiModelList`
- `removeAiModel` / `toggleProviderModelEnabled` / `toggleModelEnabled`
- `updateAiModelsConfig` / `updateAiModelsSort`
- `useFetchAiProviderModels`

#### L3: slices/aiProvider — AI Provider Management
- `createNewAiProvider` / `refreshAiProviderDetail` / `refreshAiProviderList`
- `refreshAiProviderRuntimeState` / `ensureAiProviderRuntimeStateReady`
- `removeAiProvider` / `toggleProviderEnabled`
- `updateAiProvider` / `updateAiProviderConfig` / `updateAiProviderSort`

---

### L2: store/tool — Tool / Plugin / MCP System

#### L3: slices/builtin — Built-in Tool Executors
- `invokeBuiltinTool` / `toggleBuiltinToolLoading`
- `transformApiArgumentsToAiState`
- `refreshUninstalledBuiltinTools` / `useFetchUninstalledBuiltinTools`
- **Executors:**
  - `catalog.ts` — Tool catalog
  - `heteroCli.ts` — Heterogeneous CLI
  - `lobe-activator.ts` — Activator
  - `lobe-agent-documents.ts` — Agent document tool
  - `lobe-message/` — Message tool (with trpcAdapters)
  - `lobe-notebook.ts` — Notebook tool
  - `lobe-page-agent.ts` — Page agent tool
  - `lobe-skill-store.ts` — Skill store tool
  - `lobe-skills.ts` / `lobe-skills.desktop.ts` — Skills tool
  - `lobe-topic-reference.ts` — Topic reference tool
  - `lobe-user-interaction.ts` — User interaction tool
  - `lobe-web-browsing.ts` — Web browsing tool
  - `lobe-web-onboarding.ts` — Web onboarding tool
  - `pageAgentRuntime.ts` — Page agent runtime
  - `workRegistration.ts` — Work registration
  - `worktreeDetection.ts` — Worktree detection

#### L3: slices/mcpStore — MCP Plugin Management
- `installMCPPlugin`

#### L3: slices/composioStore — Composio Integration
- `callComposioTool` / `createComposioConnection` / `reauthorizeComposioConnection`
- `useFetchAppTools` / `useFetchUserComposioConnections`

#### L3: slices/connector — Connectors
- `fetchConnectors` / `fetchAgentBoundConnectors` / `fetchAgentConnectors`
- `copyConnectorToAgent` / `mountConnectorToAgent` / `detachConnectorFromAgent`
- `getConnectorForEdit` / `createConnector` / `startConnectorOAuth`
- `updateConnector` / `syncConnectorTools` / `disconnectConnector`
- `resetConnectorPermissions` / `syncToolsFromClient` / `updateToolPermission`

#### L3: slices/customPlugin — Custom Plugins
- `installCustomPlugin` / `reinstallCustomPlugin` / `uninstallCustomPlugin`
- `updateCustomPlugin` / `updateNewCustomPlugin`

#### L3: slices/lobehubSkillStore — LobeHub Skill Store
- `callLobehubSkillTool` / `checkLobehubSkillStatus`
- `getLobehubSkillAuthorizeUrl` / `refreshLobehubSkillToken`
- `refreshLobehubSkillTools` / `revokeLobehubSkill`
- `useFetchLobehubSkillConnections` / `useFetchProviderTools`

#### L3: slices/agentSkills — Agent Skills
- `createAgentSkill` / `fetchAgentSkillDetail`
- `importAgentSkillFromGitHub` / `importAgentSkillFromUrl` / `importAgentSkillFromZip`
- `refreshAgentSkills` / `updateAgentSkill`
- `useFetchAgentSkillDetail` / `useFetchAgentSkills`

#### L3: slices/agentDocumentSkills — Agent Document Skills
- `refreshAgentDocumentSkills` / `clearAgentDocumentSkills` / `useFetchAgentDocumentSkills`

#### L3: slices/plugin — Installed Plugins
- `checkPluginsIsInstalled` / `refreshPlugins`
- `updateInstallLoadingState` / `updateInstallMcpPlugin` / `updatePluginSettings`
- `useFetchInstalledPlugins` / `useCheckPluginsIsInstalled`

---

### L2: store/file — File Management

#### L3: slices/chat — Chat File Upload
- `addChatContextSelection` / `clearChatContextSelections` / `clearChatUploadFileList`
- `dispatchChatUploadFileList` / `removeChatContextSelection` / `removeChatUploadFile`
- `startAsyncTask` / `uploadChatFiles`

#### L3: slices/chunk — File Chunking
- `closeChunkDrawer` / `highlightChunks` / `openChunkDrawer` / `semanticSearch`

#### L3: slices/document — Document CRUD
- `createDocument` / `createFolder` / `createOptimisticDocument`
- `duplicateDocument` / `fetchDocumentDetail` / `fetchDocuments`
- `loadMoreDocuments` / `removeDocument` / `removeTempDocument`
- `replaceTempDocumentWithReal` / `updateDocument`

#### L3: slices/fileManager — File Manager
- `cancelUpload` / `cancelUploads` / `dispatchDockFileList`
- `embeddingChunks` / `loadMoreKnowledgeItems` / `moveFileToFolder`
- `parseFilesToChunks` / `pushDockFileList` / `reEmbeddingChunks`
- `reParseFile` / `refreshFileList` / `publishFileToWorkspace`

#### L3: slices/resource — Resource Management
- `clearResources` / `clearCurrentQueryResources`
- `createResource` / `createResourceAndSync` / `flushSync`
- `insertLocalResource` / `patchLocalResource` / `patchLocalResourceStatuses`
- `loadMoreResources` / `markLocalResourceError`

#### L3: slices/tts — TTS Files
- `removeTTSFile` / `uploadTTSByArrayBuffers` / `useFetchTTSFile`

#### L3: slices/upload — Upload
- `uploadBase64FileWithProgress` / `uploadWithProgress`

---

### L2: store/session — Session Management

#### L3: slices/session
- `createSession` / `duplicateSession` / `switchSession`
- `pinSession` / `removeSession` / `triggerSessionUpdate`
- `updateSearchKeywords` / `updateSessionGroupId`
- `useFetchSessions` / `useSearchSessions`
- `openAllAgentsDrawer` / `closeAllAgentsDrawer`
- `internal_dispatchSessions` / `internal_updateSession` / `internal_processSessions` / `refreshSessions`

#### L3: slices/sessionGroup
- `addSessionGroup` / `removeSessionGroup`
- `updateSessionGroupName` / `updateSessionGroupSort`

---

### L2: store/userMemory — User Memory

#### L3: slices/base
- `clearEditingMemory` / `purgeAllMemories` / `refreshUserMemory`
- `setActiveMemoryContext` / `setEditingMemory` / `updateMemory`

#### L3: slices/identity
- `createIdentity` / `loadMoreIdentities` / `resetIdentitiesList` / `updateIdentity` / `useFetchIdentities`

#### L3: slices/activity
- `loadMoreActivities` / `resetActivitiesList` / `useFetchActivities`

#### L3: slices/context
- `loadMoreContexts` / `resetContextsList` / `useFetchContexts`

#### L3: slices/experience
- `loadMoreExperiences` / `resetExperiencesList` / `useFetchExperiences`

#### L3: slices/preference
- `loadMorePreferences` / `resetPreferencesList` / `useFetchPreferences`

#### L3: slices/agent
- `clearTopicMemories` / `useFetchMemoriesForTopic`

#### L3: slices/home
- `useFetchPersona` / `useFetchTags`

---

### L2: store/task — Task Management

#### L3: slices/config
- `markBriefRead` / `resolveBrief` / `runReview`
- `updateCheckpoint` / `updateReview` / `updateTaskModelConfig`
- `updatePeriodicInterval` / `setAutomationMode` / `updateSchedule`

#### L3: slices/detail
- `addComment` / `updateComment` / `addDependency`
- `fetchTaskDetail` / `createTask` / `pinDocument`
- `removeDependency` / `reorderSubtasks` / `setActiveTaskId`
- `openTopicDrawer` / `closeTopicDrawer`
- `unpinDocument` / `updateTaskVisibility` / `updateTask`
- `useFetchTaskDetail`

#### L3: slices/lifecycle
- `cancelTopic` / `runTask` / `runReadySubtasks` / `updateTaskStatus`

#### L3: slices/list
- `refreshTaskGroupList` / `fetchTaskList` / `refreshTaskList`
- `setListAgentId` / `setListVisibility` / `setViewMode`
- `useFetchTaskGroupList` / `useFetchTaskList`

---

### L2: store/page — Pages / Documents

#### L3: slices/crud
- `createNewPage` / `createOptimisticPage` / `createPage`
- `duplicatePage` / `navigateToPage` / `removePage` / `removeTempPage`
- `renamePage` / `replaceTempPageWithReal` / `updatePage` / `updatePageOptimistically`
- `useFetchPageDetail`

#### L3: slices/list
- `fetchDocuments` / `loadMoreDocuments` / `refreshDocuments`
- `publishPageToWorkspace` / `setPageVisibility`
- `setSearchKeywords` / `setShowOnlyPagesNotInLibrary` / `upsertDocument`
- `useFetchDocuments`

#### L3: slices/selection
- `closeAllPagesDrawer` / `openAllPagesDrawer` / `selectPage`
- `setRenamingPageId` / `setSelectedPageId`

---

### L2: store/image — Image Generation

#### L3: slices/createImage — `createImage`
#### L3: slices/generationBatch — `setTopicBatchLoaded` / `removeGeneration` / `removeGenerationBatch` / `refreshGenerationBatches` / `useCheckGenerationStatus`
#### L3: slices/generationConfig — `setParamOnInput` / `setWidth` / `setHeight` / `toggleAspectRatioLock` / `setAspectRatio` / `setModelAndProviderOnSelect` / `setImageNum`
#### L3: slices/generationTopic — `createGenerationTopic` / `switchGenerationTopic` / `openNewGenerationTopic` / `summaryGenerationTopicTitle`

---

### L2: store/video — Video Generation

#### L3: slices/createVideo — `createVideo` / `recreateVideo`
#### L3: slices/generationBatch — same pattern as image
#### L3: slices/generationConfig — `initializeVideoConfig` / `setModelAndProviderOnSelect` / `setParamOnInput`
#### L3: slices/generationTopic — same pattern as image

---

### L2: store/home — Home Page

#### L3: slices/agentList — `refreshAgentList` / `useFetchAgentList` / `useSearchAgents` / `openAllAgentsDrawer` / `closeAllAgentsDrawer`
#### L3: slices/group — `switchToGroup`
#### L3: slices/homeInput — `clearInputMode` / `sendAsAgent` / `sendAsGroup` / `sendAsResearch` / `sendAsWrite` / `setInputActiveMode`
#### L3: slices/recent — `refreshRecents` / `useFetchRecents` / `updateRecentTitle`
#### L3: slices/sidebarUI — `duplicateAgent` / `pinAgent` / `removeAgent` / `renameAgentGroup` / `addGroup` / `removeGroup`

---

### L2: store/agentGroup — Agent Group (Multi-Agent)

#### L3: slices/curd — `updateGroup` / `updateGroupConfig` / `updateGroupMeta`
#### L3: slices/member — `addAgentsToGroup` / `createAgentInGroup` / `removeAgentFromGroup` / `reorderGroupMembers`

---

### L2: store/discover — Marketplace / Discovery

- **assistant** — `useAssistantCategories` / `useAssistantDetail` / `useAssistantList`
- **groupAgent** — `useGroupAgentCategories` / `useGroupAgentDetail` / `useGroupAgentList`
- **mcp** — `useFetchMcpDetail` / `useFetchMcpList` / `useMcpCategories`
- **plugin** — `usePluginCategories` / `usePluginDetail` / `usePluginList`
- **model** — `useModelCategories` / `useModelDetail` / `useModelList`
- **provider** — `useProviderDetail` / `useProviderList`
- **skill** — `useFetchSkillDetail` / `useFetchRelatedSkills` / `useFetchSkillList` / `useSkillCategories`
- **social** — `addFavorite` / `removeFavorite` / `follow` / `unfollow` / `toggleLike` / `useFavoriteAgents`

---

### L2: store/library — Knowledge Base

#### L3: slices/crud — `createNewKnowledgeBase` / `refreshKnowledgeBaseList` / `removeKnowledgeBase` / `updateKnowledgeBase`
#### L3: slices/content — `addFilesToKnowledgeBase` / `removeFilesFromKnowledgeBase`
#### L3: slices/ragEval — RAG evaluation actions

---

### L2: store/notebook — `createDocument` / `refreshDocuments` / `updateDocument`

### L2: store/eval — Evaluation System
- **benchmark** — `createBenchmark` / `refreshBenchmarks` / `updateBenchmark`
- **dataset** — `refreshDatasets` / `refreshDatasetDetail`
- **experiment** — `createExperiment` / `updateExperiment` / `refreshExperiments`
- **run** — `abortRun` / `createRun` / `refreshRuns` / `batchResumeRunCases` / `retryRunCase`

### L2: store/document — Document Editor — `action.ts` / `reducer.ts` / `selectors.ts`

### L2: store/followUpAction — `fetchFor` / `abort` / `clear` / `consume`

### L2: store/topicComment — `setDraft` / `setDraftContent` / `upsertOptimisticComment`

### L2: store/mention — `addMentionedUser` / `clearMentionedUsers` / `setMentionedUsers`

---

## L1: features/ — UI Feature Layer

### L2: features/Conversation — Chat Main UI

#### L3: Messages/ — Message Type Components
| Component | Description |
|-----------|-------------|
| `Assistant/` | Assistant message |
| `AssistantGroup/` | Assistant group message (with Tool sub-messages) |
| `User/` | User message (with AudioPlayer, FileListViewer) |
| `Tool/` | Tool message |
| `Task/` | Task message (with Actions, ClientTaskDetail, TaskDetailPanel) |
| `TaskCallback/` | Task callback message |
| `Tasks/` | Batch tasks |
| `AgentCouncil/` | Multi-agent council message |
| `CompressedGroup/` | Compressed message group |
| `EditedFilesCard/` | Edited files card |
| `GroupTasks/` | Group task list |
| `MessageWorks/` | Message work output |
| `SignalCallbacks/` | Signal callbacks |
| `Verify/` | Verification message |

##### L4: Messages/components/
- `ContentLoading` — Loading indicator
- `DisplayContent` — Content display
- `ImageFileListViewer` — Image file viewer
- `MessageBranch` — Branch switcher
- `Reasoning` — Reasoning display
- `RichContentRenderer` — Rich content
- `SearchGrounding` — Search grounding

##### L4: Messages/Assistant/Actions/
- Action bar for assistant messages (copy, regenerate, branch, continue, delete, TTS, translate, share)

##### L4: Messages/AssistantGroup/Tool/
- `Actions/` — Tool action bar
- `Debug/` — Tool debug panel
- `Detail/` — Tool detail (Arguments, Intervention, LoadingPlaceholder, Render)
- `Inspector/` — Tool inspector

##### L4: Messages/components/MessageActionBar/actions/
- Individual action implementations (copy, edit, delete, regenerate, branch, continue, translate, TTS, share, forward)

#### L3: ChatList/ — Chat List (Virtualized)
- `components/` — List components (AutoScroll, BackBottom)
- `hooks/` — Virtualization and scroll hooks
- `utils/` — Utilities

#### L3: Markdown/plugins/ — Markdown Render Plugins
| Plugin | Renders |
|--------|---------|
| `LobeArtifact/` | Artifact blocks |
| `LobeThinking/` | Thinking process blocks |
| `Thinking/` | Thinking (alt) |
| `Tool/` | Tool call blocks |
| `Skill/` | Skill references |
| `Task/` | Task references |
| `Mention/` | @mentions |
| `LocalFile/` | Local file embeds |
| `LocalFileLink/` | Local file links |
| `Link/` | Enhanced links |
| `LobeAgents/` | Agent references |
| `ImageSearchRef/` | Image search references |
| `UserFeedback/` | User feedback blocks |
| `remarkPlugins/` | Custom remark plugins |

#### L3: WorkingSidebar/ — Working Sidebar (Right Panel Context)
| Section | Content |
|---------|---------|
| `Browser/` | In-context web browser |
| `Files/` | Working files |
| `Overview/` | Agent/topic overview |
| `ParamsSection/` | Model parameters |
| `ProgressSection/` | Task/operation progress |
| `ResourcesSection/` | Resources (AgentDocumentsGroup, DeviceLevelSkills, ProjectLevelSkills, UserLevelSkills) |
| `Review/` | Code review (FileItem, FileRow, FileTreeNav, GroupHeader) |
| `WorksSection/` | Work output (VersionList, WorkVersionHistoryCard) |
| `WorkspaceTab.tsx` | Workspace tab |

#### L3: Conversation/ChatInput/ — In-conversation Input
- `OpStatusTray/` — Operation status tray
- `VerifyTray/` — Verification tray

#### L3: InterventionBar/ — Human intervention bar
#### L3: FollowUp/ — Follow-up suggestions
#### L3: TodoProgress/ — Todo progress
#### L3: Error/ — Error displays (OllamaBizError, OllamaSetupGuide, PlanLimitCard)
#### L3: MessageForward/ — Message forwarding (TopicForwardModal)

---

### L2: features/ChatInput — Input System

#### L3: ActionBar/ — Action Bar Items
| Item | Function |
|------|----------|
| `AgentMode/` | Agent mode switcher |
| `Clear/` | Clear conversation |
| `History/` | Context history window |
| `Knowledge/` | Knowledge base selector |
| `Memory/` | Memory toggle |
| `Mention/` | @mention |
| `Model/` | Model selector |
| `ModelLabel/` | Model display label |
| `Params/` | Model parameters |
| `Plus/` | More actions |
| `PromptTransform/` | Prompt transform |
| `Search/` | Web search toggle (FunctionCallingModelSelect) |
| `Token/` | Token count |
| `Tools/` | Tool selector |
| `Typo/` | Spell check |
| `Upload/` | File upload |

#### L3: InputEditor/ — Editor
- `ActionTag/` — Action tags
- `LocalFileTag/` — Local file tags
- `MentionMenu/` — @mention menu
- `ReferTopic/` — Topic reference

#### L3: ControlBar/ — Control bar (send settings)
#### L3: SendArea/ — Send button area
#### L3: Desktop/ — Desktop variant (ContextContainer/, FilePreview/)
#### L3: Mobile/ — Mobile variant (FilePreview/)
#### L3: ChatInputNotice/ — Input notice
#### L3: TypoBar/ — Typo correction bar
#### L3: components/UploadDetail/ — Upload detail

---

### L2: features/AgentSetting — Agent Settings

| Sub-module | Configures |
|------------|-----------|
| `AgentMeta/` | Name, avatar, description, background |
| `AgentOpening/` | Opening message, suggested questions |
| `AgentCategory/` | Category assignment |
| `AgentConnectors/` | Connected services |
| `AgentGraphRuntime/` | Graph runtime config |
| `AgentSelfIteration/` | Self-iteration settings |

---

### L2: features/Portal — Right-side Portal Panel

| Sub-module | Shows |
|------------|-------|
| `Artifacts/` | Artifact preview (code, React live) |
| `Thread/` | Thread conversation |
| `GroupThread/` | Group thread (Body, Header, Title) |
| `FilePreview/` | File preview |
| `LocalFile/` | Local file editor |
| `Document/` | Document view |
| `MessageDetail/` | Message detail |
| `Notebook/` | Notebook |
| `Plugins/` | Plugin UI |
| `TaskDetail/` | Task detail |
| `TopicComments/` | Topic comments |
| `Acceptance/` | Acceptance review |
| `AcceptanceCheck/` | Acceptance check |
| `AgentDetail/` | Agent detail |
| `VerifyReport/` | Verify report |
| `VerifyResult/` | Verify result |
| `Home/` | Portal home (Files, Plugins/ArtifactList) |

---

### L2: features/MCP — MCP Plugin System UI

- `MCPDetail/` — MCP plugin detail page
- `MCPInstallProgress/` — Install progress (InstallError)
- `MCPSettings/` — MCP settings

---

### L2: features/ModelSwitchPanel — Model Switch Panel

- `BenchmarkModal/` — Model benchmark comparison (CompareRadar)
- `ControlsForm/` — Runtime controls (reasoning effort sliders for GPT-5/5.1/5.2/5.6/DeepSeek/GLM/Grok/Codex, ContextCachingSwitch)
- `List/` — Model list with search/filter
- `hooks/` — Panel hooks

---

### L2: features/AgentSidebar — Agent Sidebar

#### L3: Header/ — Sidebar header
- `Agent/` — Agent switcher panel

#### L3: Topic/ — Topic sidebar
- `AllTopicsDrawer/` — All topics drawer
- `List/` → `Item/` — Topic list items
- `TopicListContent/` — View modes:
  - `ByProjectMode/` — By project
  - `ByStatusMode/` — By status
  - `ByTimeMode/` — By time
  - `FlatMode/` — Flat list
  - `SearchResult/` — Search results
  - `ThreadList/` → `ThreadItem/` — Thread items
- `TopicSearchBar/` — Topic search
- `hooks/` / `utils/`

#### L3: Task/ — Task sidebar section

---

### L2: features/AgentTasks — Task Management UI

- `AgentTaskList/` — Task list
- `AgentTaskDetail/` — Task detail (scheduler, TopicChatDrawer, VerifyCriterionModal)
- `CreateTaskModal/` — Create task modal
- `features/` — Task feature components (icons)

---

### L2: Other Key Feature Modules

| Module | Function |
|--------|----------|
| `features/Generation/` | Image/video generation UI |
| `features/AgentBuilder/` | Agent builder wizard (SuggestionChips) |
| `features/Connectors/` | Connector management (AddConnectorModal, ConnectorDetail, ConnectorList, CustomConnectorModal) |
| `features/Work/` + `WorkGallery/` | Work output display |
| `features/WorkingDirectory/` | Working directory browser |
| `features/Share/` + `ShareModal/` | Share (ShareImage, ShareJSON, SharePdf, ShareText) |
| `features/CommandMenu/` | Command palette |
| `features/FloatingChatPanel/` | Floating chat panel |
| `features/ChatTerminal/` | Terminal in chat |
| `features/Messenger/` | External messenger integration (LinkModal, Verify) |
| `features/SkillStore/` | Skill marketplace (Search, SkillDetail, SkillList with Builtin/Community/LobeHub/MarketSkills/MCP) |
| `features/TopicComment/` | Topic comments |
| `features/PageEditor/` | Page editor (Copilot, EditorCanvas, Header, History with CompareModal, RightPanel) |
| `features/Pages/` | Pages list (PageLayout with AllPagesDrawer) |
| `features/LocalFile/` | Local file management |
| `features/FileTree/` | File tree |
| `features/FileViewer/` | File viewer (Code, HTML, Image, MSDoc, PDF, Video renderers) |
| `features/ResourceManager/` | Resource manager (ChunkDrawer, Editor, Explorer with MasonryView/ListView, FolderTree, UploadDock) |
| `features/LibraryModal/` | Knowledge base assignment (AssignKnowledgeBase, CreateNew) |
| `features/Verify/` | Verification UI (Acceptance/Workspace) |
| `features/DailyBrief/` | Daily brief |
| `features/Onboarding/` | Onboarding flow |
| `features/AgentHome/` | Agent home page |
| `features/AgentDocumentPage/` | Agent document page (DocumentsEmpty, Header, Layout, RightPanel) |
| `features/AgentDocumentsExplorer/` | Agent documents explorer |
| `features/AgentPermission/` | Agent permission UI |
| `features/AgentProfileCard/` | Agent profile card |
| `features/AgentSkillDetail/` + `AgentSkillEdit/` + `AgentSkillStore/` | Agent skill management |
| `features/AgentTopicManager/` | Topic manager (MoveTopicsModal) |
| `features/AgentUsage/` | Usage stats |
| `features/AgentViewAll/` | View all agents |
| `features/Billboard/` | Announcements |
| `features/HotkeyHelperPanel/` | Keyboard shortcuts panel |
| `features/Electron/` | Desktop-specific (HeterogeneousAgent, ScreenCapture, TabHost, titlebar, updater) |
| `features/DevPanel/` + `DevDock/` | Developer tools |

---

## L1: services/ — Service Layer

### L2: Core Services

| Service | Key Methods |
|---------|-------------|
| `aiChat.ts` | `sendMessageInServer`, `generateJSON`, `recordTracingFeedback` |
| `agent.ts` | `createAgent`, `publishAgentToWorkspace`, `getAgentConfigById`, `updateAgentConfig`, `updateAgentMeta`, `removeAgent`, `queryAgents` |
| `task.ts` | `find`, `getDetail`, `list`, `groupList`, `getSubtasks`, `getTaskTree`, `create`, `update`, `updateStatus` |
| `mcp.ts` | `invokeMcpToolCall`, `checkInstallation` |
| `messenger.ts` | `availablePlatforms`, `confirmLink`, `listMyLinks`, `sendMessengerPush`, `createWechatQrSession` |
| `generation.ts` | `getGenerationStatus` |
| `image.ts` | `createImage` |
| `video.ts` | `createVideo` |
| `notebook.ts` | `createDocument`, `updateDocument`, `getDocument`, `listDocuments` |
| `search.ts` | `search`, `crawlPage`, `crawlPages`, `webSearch` |
| `projectFile.ts` | `getProjectFileIndex`, `searchProjectFiles`, `getLocalFilePreview`, `moveProjectFiles`, `writeProjectFile` |
| `projectSkill.ts` | `listProjectSkills` |
| `work.ts` | `listByConversation`, `listByWorkspace`, `registerTask`, `registerDocument`, `handleSkillToolResult`, `refreshAll` |
| `knowledgeBase.ts` | `createKnowledgeBase`, `getKnowledgeBaseById`, `addFilesToKnowledgeBase`, `removeFilesFromKnowledgeBase` |
| `upload.ts` | `uploadFileToS3`, `uploadBase64ToS3`, `uploadDataToS3` |
| `verify.ts` | `getAcceptanceBundle`, `saveAcceptanceChecklist`, `acceptDelivery`, `rejectDelivery`, `reviewChecks` |
| `heterogeneousAgent.ts` | Heterogeneous agent communication |
| `agentDocument.ts` | `getTemplates`, `getDocuments`, `createDocument`, `readDocument`, `replaceDocumentContent` |
| `agentSignal.ts` | `listReceipts`, `rollbackReceipt`, `emitSourceEvent` |
| `cloudSandbox.ts` | `callTool`, `exportAndUploadFile` |
| `git.ts` | `listGitBranches`, `checkoutGitBranch`, `pullGitBranch`, `pushGitBranch`, `getGitWorkingTreeStatus` |
| `social.ts` | `follow`, `unfollow`, `addFavorite`, `removeFavorite`, `getMyFavorites` |
| `models.ts` | `getModels`, `downloadModel`, `abortPull` |
| `rag.ts` | `parseFileContent`, `createEmbeddingChunksTask`, `semanticSearch`, `semanticSearchForChat` |
| `ragEval.ts` | `createDataset`, `createEvaluation`, `startEvaluationTask` |
| `topicComment.ts` | `create`, `get`, `listReplies`, `listThreads`, `summary`, `update` |
| `followUpAction.ts` | `extract` |
| `brief.ts` | `listUnresolved`, `markRead`, `resolve` |
| `device.ts` | `listDevices`, `updateDevice`, `statPath`, `checkCapability` |
| `usage.ts` | `findByMonth`, `getAgentUsageStats` |
| `webBrowsing.ts` | `upsertCrawledDocument` |
| `trace.ts` | `traceEvent` |

---

## Usage Guide

Mark each L3/L4 node with one of:
- **`adopt`** — We need this, implement it
- **`adapt`** — We need the capability but will redesign for our architecture
- **`defer`** — Useful but not priority now
- **`reject`** — We don't need this (LobeHub-specific, doesn't fit our product)

Then we'll use the marked tree to drive per-module design docs.
