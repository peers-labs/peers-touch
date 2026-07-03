import Foundation

enum AppletState {
    case cold
    case materializing
    case visible
    case hiddenWarm
    case paused
    case suspended
    case destroyed
}

enum AppletLifecycleEvent {
    case launch
    case ready
    case show
    case hide
    case pause
    case resume
    case suspend
    case restore
    case destroy
    case error
}

extension AppletState {
    func canTransition(_ event: AppletLifecycleEvent) -> Bool {
        switch event {
        case .launch:
            self == .cold
        case .ready:
            self == .materializing
        case .show:
            self == .hiddenWarm || self == .paused || self == .suspended
        case .hide:
            self == .visible
        case .pause:
            self == .visible || self == .hiddenWarm
        case .resume:
            self == .paused
        case .suspend:
            self == .hiddenWarm || self == .paused
        case .restore:
            self == .suspended
        case .destroy, .error:
            self != .cold && self != .destroyed
        }
    }

    func nextState(for event: AppletLifecycleEvent, resumeTarget: AppletState = .visible) throws -> AppletState {
        guard canTransition(event) else {
            throw AppletError.bridgeFailed("Invalid applet lifecycle transition: \(self) + \(event)")
        }
        switch event {
        case .launch:
            return .materializing
        case .ready, .show, .restore:
            return .visible
        case .hide:
            return .hiddenWarm
        case .pause:
            return .paused
        case .resume:
            return resumeTarget
        case .suspend:
            return .suspended
        case .destroy, .error:
            return .destroyed
        }
    }
}

enum AppletSurfaceCommand {
    case show
    case hide
    case detach
    case destroy
}

struct AppletInstanceRecord {
    let appletId: String
    let instanceId: String
    let sessionId: String
    private(set) var state: AppletState
    private(set) var createdAt: Date
    private(set) var updatedAt: Date
    private(set) var lastAccessedAt: Date
    private(set) var estimatedMemoryBytes: Int

    mutating func markAccessed(at now: Date) {
        lastAccessedAt = now
        updatedAt = now
    }

    mutating func transition(to nextState: AppletState, at now: Date) {
        state = nextState
        updatedAt = now
        if nextState == .visible {
            lastAccessedAt = now
        }
    }

    mutating func updateMemoryEstimate(_ bytes: Int, at now: Date) {
        estimatedMemoryBytes = max(0, bytes)
        updatedAt = now
    }
}

struct AppletResourcePolicy {
    let lruSize: Int
    let maxSuspended: Int
    let hiddenWarmTtl: TimeInterval
    let suspendedTtl: TimeInterval
    let pausedTtl: TimeInterval

    static let mobile = AppletResourcePolicy(
        lruSize: 3,
        maxSuspended: 8,
        hiddenWarmTtl: 30 * 60,
        suspendedTtl: 120 * 60,
        pausedTtl: 15 * 60
    )
}

enum AppletMemoryPressureLevel {
    case low
    case moderate
    case critical
}

struct AppletSchedulerAction {
    let instanceId: String
    let event: AppletLifecycleEvent
}

protocol AppletSurfaceCacheHooks: AnyObject {
    func apply(_ command: AppletSurfaceCommand, instanceId: String)
    func estimateMemory(instanceId: String) -> Int
}

final class AppletInstanceRegistry {
    private var records: [String: AppletInstanceRecord] = [:]

    func upsert(_ record: AppletInstanceRecord) {
        records[record.instanceId] = record
    }

    func record(for instanceId: String) -> AppletInstanceRecord? {
        records[instanceId]
    }

    func recordForApplet(id appletId: String) -> AppletInstanceRecord? {
        records.values
            .filter { $0.appletId == appletId && $0.state != .destroyed }
            .sorted { $0.lastAccessedAt > $1.lastAccessedAt }
            .first
    }

    func allRecords() -> [AppletInstanceRecord] {
        Array(records.values)
    }

    func markAccessed(_ instanceId: String, at now: Date) {
        records[instanceId]?.markAccessed(at: now)
    }

    func transition(_ instanceId: String, to state: AppletState, at now: Date) {
        records[instanceId]?.transition(to: state, at: now)
    }

    func updateMemoryEstimate(_ instanceId: String, bytes: Int, at now: Date) {
        records[instanceId]?.updateMemoryEstimate(bytes, at: now)
    }

    func remove(_ instanceId: String) {
        records.removeValue(forKey: instanceId)
    }
}

final class AppletResourceScheduler {
    private let policy: AppletResourcePolicy

    init(policy: AppletResourcePolicy = .mobile) {
        self.policy = policy
    }

    func actionsForSweep(records: [AppletInstanceRecord], now: Date) -> [AppletSchedulerAction] {
        var actions: [AppletSchedulerAction] = []
        let activeRecords = records.filter { $0.state != .destroyed }

        for record in activeRecords {
            switch record.state {
            case .hiddenWarm where now.timeIntervalSince(record.updatedAt) >= policy.hiddenWarmTtl:
                actions.append(AppletSchedulerAction(instanceId: record.instanceId, event: .suspend))
            case .paused where now.timeIntervalSince(record.updatedAt) >= policy.pausedTtl:
                actions.append(AppletSchedulerAction(instanceId: record.instanceId, event: .suspend))
            case .suspended where now.timeIntervalSince(record.updatedAt) >= policy.suspendedTtl:
                actions.append(AppletSchedulerAction(instanceId: record.instanceId, event: .destroy))
            default:
                break
            }
        }

        let warmRecords = activeRecords
            .filter { $0.state == .hiddenWarm }
            .sorted { $0.lastAccessedAt < $1.lastAccessedAt }
        if warmRecords.count > policy.lruSize {
            actions.append(contentsOf: warmRecords
                .dropLast(policy.lruSize)
                .map { AppletSchedulerAction(instanceId: $0.instanceId, event: .suspend) })
        }

        let suspendedRecords = activeRecords
            .filter { $0.state == .suspended }
            .sorted { $0.updatedAt < $1.updatedAt }
        if suspendedRecords.count > policy.maxSuspended {
            actions.append(contentsOf: suspendedRecords
                .dropLast(policy.maxSuspended)
                .map { AppletSchedulerAction(instanceId: $0.instanceId, event: .destroy) })
        }

        return deduplicate(actions)
    }

    func actionsForMemoryPressure(
        _ level: AppletMemoryPressureLevel,
        records: [AppletInstanceRecord]
    ) -> [AppletSchedulerAction] {
        switch level {
        case .low:
            return []
        case .moderate:
            guard let oldestSuspended = records
                .filter({ $0.state == .suspended })
                .sorted(by: { $0.updatedAt < $1.updatedAt })
                .first else {
                return []
            }
            return [AppletSchedulerAction(instanceId: oldestSuspended.instanceId, event: .destroy)]
        case .critical:
            return records
                .filter { $0.state != .visible && $0.state != .destroyed }
                .map { AppletSchedulerAction(instanceId: $0.instanceId, event: .destroy) }
        }
    }

    private func deduplicate(_ actions: [AppletSchedulerAction]) -> [AppletSchedulerAction] {
        var seen: Set<String> = []
        return actions.filter { action in
            let key = "\(action.instanceId):\(action.event)"
            if seen.contains(key) { return false }
            seen.insert(key)
            return true
        }
    }
}

final class AppletManager {
    private var sessions: [String: AppletBridgeSession] = [:]
    private var sessionIdsByInstanceId: [String: String] = [:]
    private var applets: [String: AppletInfo] = [:]
    private var rejectedDiagnostics: [String: [String]] = [:]
    private let registry: AppletInstanceRegistry
    private let scheduler: AppletResourceScheduler
    private weak var surfaceHooks: (any AppletSurfaceCacheHooks)?
    private let bundleStorage: AppletBundleStorage
    private let bridgeDispatcher: BridgeDispatcher
    private var sweepTimer: Timer?

    init(bundleStorage: AppletBundleStorage, bridgeDispatcher: BridgeDispatcher) {
        self.bundleStorage = bundleStorage
        self.bridgeDispatcher = bridgeDispatcher
        self.registry = AppletInstanceRegistry()
        self.scheduler = AppletResourceScheduler()
    }

    private init(
        bundleStorage: AppletBundleStorage,
        bridgeDispatcher: BridgeDispatcher,
        registry: AppletInstanceRegistry,
        scheduler: AppletResourceScheduler
    ) {
        self.bundleStorage = bundleStorage
        self.bridgeDispatcher = bridgeDispatcher
        self.registry = registry
        self.scheduler = scheduler
    }

    func registerSurfaceHooks(_ hooks: any AppletSurfaceCacheHooks) {
        surfaceHooks = hooks
    }

    func startSweepTimer(interval: TimeInterval = 60) {
        sweepTimer?.invalidate()
        sweepTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            self?.runSweep()
        }
    }

    func stopSweepTimer() {
        sweepTimer?.invalidate()
        sweepTimer = nil
    }

    func scanLocalApplets() -> [AppletManifest] {
        rejectedDiagnostics.removeAll()
        applets.removeAll()

        for info in bundleStorage.listCachedBundles() {
            let manifest = info.manifest
            if applets[manifest.id] != nil {
                rejectedDiagnostics[manifest.id] = ["Duplicate applet ID: \(manifest.id)"]
                continue
            }
            if !manifest.targets.contains("ios") {
                rejectedDiagnostics[manifest.id] = ["Applet does not target iOS platform"]
                continue
            }
            let issues = manifest.validate()
            if !issues.isEmpty {
                rejectedDiagnostics[manifest.id] = issues
                continue
            }
            applets[manifest.id] = info
        }

        return applets.values.map(\.manifest)
    }

    func loadApplet(id: String) throws -> AppletBridgeSession {
        if applets.isEmpty {
            _ = scanLocalApplets()
        }

        guard let info = applets[id] else {
            if let issues = rejectedDiagnostics[id] {
                throw AppletError.invalidManifest(issues.joined(separator: "; "))
            }
            throw AppletError.bundleNotFound(id)
        }

        return try loadApplet(manifest: info.manifest)
    }

    func loadApplet(manifest: AppletManifest) throws -> AppletBridgeSession {
        let issues = manifest.validate()
        guard issues.isEmpty else {
            throw AppletError.invalidManifest(issues.joined(separator: "; "))
        }

        if let existingRecord = registry.recordForApplet(id: manifest.id),
           let existing = session(for: existingRecord.instanceId) {
            switch existing.state {
            case .hiddenWarm:
                try dispatchLifecycle(.show, for: existing)
            case .paused:
                try dispatchLifecycle(.resume, for: existing)
            case .suspended:
                try dispatchLifecycle(.restore, for: existing)
            default:
                registry.markAccessed(existing.instanceId, at: Date())
                break
            }
            return existing
        }

        let instanceId = "\(manifest.id):default"
        let session = AppletBridgeSession(
            manifest: manifest,
            instanceId: instanceId,
            bridgeDispatcher: bridgeDispatcher
        )
        sessions[session.sessionId] = session
        sessionIdsByInstanceId[instanceId] = session.sessionId

        let now = Date()
        registry.upsert(AppletInstanceRecord(
            appletId: manifest.id,
            instanceId: instanceId,
            sessionId: session.sessionId,
            state: session.state,
            createdAt: now,
            updatedAt: now,
            lastAccessedAt: now,
            estimatedMemoryBytes: 0
        ))
        try dispatchLifecycle(.launch, for: session)
        try dispatchLifecycle(.ready, for: session)
        return session
    }

    func getAppletInfo(_ id: String) -> AppletInfo? {
        applets[id]
    }

    func getBundleURL(_ id: String) -> URL? {
        applets[id]?.bundleURL ?? bundleStorage.bundleURL(for: id)
    }

    func getApplet(_ id: String) -> AppletBridgeSession? {
        guard let record = registry.recordForApplet(id: id) else { return nil }
        return session(for: record.instanceId)
    }

    func unloadApplet(_ id: String) {
        guard let record = registry.recordForApplet(id: id),
              let session = session(for: record.instanceId) else {
            return
        }
        destroySession(session)
    }

    func hideApplet(_ id: String) {
        guard let record = registry.recordForApplet(id: id),
              let session = session(for: record.instanceId),
              session.state == .visible else {
            return
        }
        try? dispatchLifecycle(.hide, for: session)
    }

    func runSweep(now: Date = Date()) {
        applySchedulerActions(scheduler.actionsForSweep(records: registry.allRecords(), now: now))
    }

    func handleMemoryPressure(_ level: AppletMemoryPressureLevel) {
        applySchedulerActions(scheduler.actionsForMemoryPressure(level, records: registry.allRecords()))
    }

    func pauseActiveInstances() {
        for record in registry.allRecords()
            where record.state == .visible || record.state == .hiddenWarm {
            guard let session = session(for: record.instanceId) else { continue }
            try? dispatchLifecycle(.pause, for: session)
        }
    }

    func resumePausedInstances() {
        for record in registry.allRecords() where record.state == .paused {
            guard let session = session(for: record.instanceId) else { continue }
            try? dispatchLifecycle(.resume, for: session)
        }
    }

    func recordSurfaceMemoryEstimate(instanceId: String) {
        registry.updateMemoryEstimate(
            instanceId,
            bytes: surfaceHooks?.estimateMemory(instanceId: instanceId) ?? 0,
            at: Date()
        )
    }

    func getDiagnostics() -> [AppletDiagnostic] {
        rejectedDiagnostics.map { source, issues in
            AppletDiagnostic(source: source, issues: issues)
        }
    }

    private func session(for instanceId: String) -> AppletBridgeSession? {
        guard let sessionId = sessionIdsByInstanceId[instanceId] else { return nil }
        return sessions[sessionId]
    }

    private func dispatchLifecycle(_ event: AppletLifecycleEvent, for session: AppletBridgeSession) throws {
        try session.dispatchLifecycle(event)
        registry.transition(session.instanceId, to: session.state, at: Date())
        applySurfaceCommand(
            surfaceCommand(for: event, resultingState: session.state),
            instanceId: session.instanceId
        )
    }

    private func surfaceCommand(
        for event: AppletLifecycleEvent,
        resultingState: AppletState
    ) -> AppletSurfaceCommand? {
        switch event {
        case .ready, .show, .restore:
            return .show
        case .resume:
            return resultingState == .visible ? .show : .hide
        case .hide:
            return .hide
        case .suspend:
            return .detach
        case .destroy, .error:
            return .destroy
        case .launch, .pause:
            return nil
        }
    }

    private func applySurfaceCommand(_ command: AppletSurfaceCommand?, instanceId: String) {
        guard let command else { return }
        surfaceHooks?.apply(command, instanceId: instanceId)
    }

    private func applySchedulerActions(_ actions: [AppletSchedulerAction]) {
        for action in actions {
            guard let session = session(for: action.instanceId) else { continue }
            if action.event == .destroy || action.event == .error {
                destroySession(session)
                continue
            }
            try? dispatchLifecycle(action.event, for: session)
        }
    }

    private func destroySession(_ session: AppletBridgeSession) {
        session.destroy()
        applySurfaceCommand(.destroy, instanceId: session.instanceId)
        sessions.removeValue(forKey: session.sessionId)
        sessionIdsByInstanceId.removeValue(forKey: session.instanceId)
        registry.remove(session.instanceId)
    }
}

enum AppletError: Error {
    case invalidManifest(String)
    case bundleNotFound(String)
    case bridgeFailed(String)
}
