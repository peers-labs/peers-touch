import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { machineResourcesPath } from '../lib/machine-dev-paths.mjs';
import {
  checkWorkspace, mutateMachineResources, observeLeases, verifyHeldLease, writeMachineDocumentAtomic,
} from './machine-dev-registry.mjs';
import { fail } from './machine-dev-primitives.mjs';
import {
  RESOURCE_ACTIONS, RESOURCE_KIND, iosRequirement, requireCompatible,
  readResourceState, resourceDigest, resourceDigestEndpoint, resourceText, validateResourceState, validateResourceTarget,
} from './machine-dev-resource-contract.mjs';
import { IOSResourceProvider, MACHINE_DEVICE_NAME_PREFIX, appArtifactDigest } from './machine-dev-ios-provider.mjs';
import { inspectGitWorkspace } from './git-workspace.mjs';

export function assignedResource(options, resolved, selector) {
  const state = readResourceState(options);
  const assignment = state.assignments.find((item) => item.profile === resolved.profile.profile);
  const candidates = (assignment?.resources ?? []).map((ref) => ({
    ...state.instances.find((item) => item.id === ref.id), purpose: ref.purpose,
  })).filter((item) => item.progress !== 'removed');
  const selected = selector
    ? candidates.filter((item) => item.id === selector || item.displayName === selector || item.purpose === selector)
    : candidates;
  if (selected.length !== 1) {
    fail('RESOURCE_SELECTION_REQUIRED', 'select a readable name or purpose from the Profile assignment', {
      profile: resolved.profile.profile,
      devices: candidates.map(({ id, displayName, purpose, progress }) => ({ id, name: displayName, purpose, progress })),
    });
  }
  return selected[0];
}

// Tests substitute provider/admission functions explicitly. Production always
// uses the original workspace/Profile fence and canonical machine document.
export class MachineResourceOwner {
  constructor(options = {}, dependencies = {}) {
    this.options = options;
    this.provider = dependencies.provider ?? new IOSResourceProvider();
    this.admit = dependencies.admit ?? (() => checkWorkspace(options));
    this.transaction = dependencies.transaction ?? ((callback) => mutateMachineResources(options, callback));
    this.leases = dependencies.leases ?? (() => observeLeases(options).activeLeases);
    this.source = dependencies.source ?? ((resolved) => {
      const snapshot = inspectGitWorkspace(resolved.binding.canonicalRoot, {
        excludePaths: ['apps/mobile/src-tauri/gen/apple/assets'],
      });
      if (!snapshot.stable) fail('RUNTIME_IDENTITY_MISMATCH', 'workspace bytes changed while reading source');
      return { ...resolved.source, workspaceDigest: snapshot.workspaceDigest };
    });
    this.verifyLease = dependencies.verifyLease ?? ((instance) => verifyHeldLease({
      ...options, resourceKind: RESOURCE_KIND, resourceId: instance.providerId,
      expectedWorkspaceDigest: process.env.PT_MACHINE_LEASE_SOURCE_WORKSPACE_DIGEST,
    }));
  }

  change(callback) {
    return this.transaction((resolved) => {
      const state = readResourceState(this.options);
      const result = callback(state, resolved);
      validateResourceState(state);
      writeMachineDocumentAtomic(machineResourcesPath(this.options.home), state);
      return result;
    });
  }

  projection(state, instance, observation = null) {
    const references = state.assignments.flatMap((assignment) =>
      assignment.resources.filter((item) => item.id === instance.id)
        .map((item) => ({ profile: assignment.profile, purpose: item.purpose })));
    return {
      ...instance, name: instance.displayName,
      sharedProfiles: references,
      holders: this.leases().filter((item) => item.resourceKind === RESOURCE_KIND && item.resourceId === instance.providerId),
      observation,
    };
  }

  discover() {
    const resolved = this.admit();
    const requirement = iosRequirement(resolved.profile);
    const state = readResourceState(this.options);
    const devices = this.provider.inventory().map((observed) => {
      const instance = state.instances.find((item) => item.providerId === observed.providerId);
      return {
        ...(instance ? this.projection(state, instance, observed) : {
          id: null, name: observed.name, progress: 'external', sharedProfiles: [],
          // Surface live OS leases even for undocumented devices so a sweep can
          // refuse a device that another process still physically holds.
          holders: this.leases().filter((item) =>
            item.resourceKind === RESOURCE_KIND && item.resourceId === observed.providerId),
          content: null, observation: observed,
        }),
        compatible: observed.available && observed.runtime === requirement.runtime && observed.deviceType === requirement.deviceType,
        selectionKey: resourceDigest({ providerId: observed.providerId, name: observed.name, runtime: observed.runtime, deviceType: observed.deviceType }),
      };
    });
    return { profile: resolved.profile.profile, requirement, devices, snapshot: resourceDigest(devices) };
  }

  assign({ names, count, purpose, snapshot, selectionKeys, create = false, preparationId } = {}) {
    const discovery = this.discover();
    const requestedPurpose = resourceText(purpose, 'purpose');
    if (snapshot && snapshot !== discovery.snapshot) fail('RESOURCE_SELECTION_STALE', 'inventory changed; show the current readable device list again');
    if (names && !Array.isArray(names)) names = [names];
    let selected;
    if (selectionKeys?.length) {
      if (!snapshot) fail('RESOURCE_SELECTION_STALE', 'list selection requires its discovery snapshot');
      selected = selectionKeys.map((key) => {
        const device = discovery.devices.find((item) => item.selectionKey === key);
        if (!device) fail('RESOURCE_SELECTION_STALE', 'selected list item no longer exists');
        return device;
      });
    } else if (names?.length) {
      selected = names.map((name) => {
        const matches = discovery.devices.filter((item) => item.name === name || item.observation.name === name);
        if (matches.length !== 1) fail('RESOURCE_NAME_AMBIGUOUS', 'device name is missing or ambiguous; show model/runtime/shared Profiles', { name, devices: matches });
        return matches[0];
      });
    } else if (!create) {
      const amount = Number(count);
      if (!Number.isSafeInteger(amount) || amount < 1) fail('INVALID_ARGUMENT', 'an explicit positive count or readable selection is required');
      // Delegated matching selects compatible machine-owned instances in stable
      // provider order. Sharing is visible; neither count nor sharing grants overwrite.
      selected = discovery.devices.filter((item) => item.compatible && item.id &&
        item.provenance === 'machine-created' && item.holders.length === 0 &&
        (discovery.requirement.data !== 'fresh' || item.content === null))
        .sort((a, b) => a.observation.providerId.localeCompare(b.observation.providerId)).slice(0, amount);
      if (selected.length !== amount) fail('RESOURCE_MATCH_REQUIRED', 'count request reached discovery; choose the shown devices or explicitly create the missing devices', {
        requestedCount: amount, devices: discovery.devices,
      });
    }
    if (create) {
      if (names?.length || selectionKeys?.length) fail('INVALID_ARGUMENT', 'creation and inventory selection are separate requests');
      const amount = Number(count);
      if (!Number.isSafeInteger(amount) || amount < 1) fail('INVALID_ARGUMENT', 'creation needs an explicit positive count');
      const requestId = resourceText(preparationId, 'preparationId');
      const prepared = this.change((state, resolved) => {
        const requirement = iosRequirement(resolved.profile);
        const prior = state.instances.filter((item) => item.preparation?.requestId === requestId);
        const requestDigest = resourceDigest({ profile: resolved.profile.profile, requirement, amount, purpose: requestedPurpose });
        if (prior.length) {
          if (prior.length !== amount || prior.some((item) => item.preparation.requestDigest !== requestDigest)) {
            fail('RESOURCE_PREPARATION_MISMATCH', 'preparation ID cannot be reused for a different creation');
          }
          return prior.map((item) => item.id);
        }
        const beforeProviderIds = discovery.devices.map((item) => item.observation.providerId);
        const result = [];
        for (let index = 0; index < amount; index += 1) {
          const id = `ios-${randomBytes(12).toString('hex')}`;
          const nonce = randomBytes(16).toString('hex');
          const preparation = {
            requestId, requestDigest, nonce, beforeProviderIds,
            runtime: requirement.runtime, deviceType: requirement.deviceType,
            displayName: `${requestedPurpose} ${index + 1}`,
            createdAt: new Date().toISOString(),
          };
          preparation.providerName = this.provider.prepareIdentity(preparation);
          state.instances.push({
            id, kind: RESOURCE_KIND, providerId: null, displayName: preparation.displayName,
            revision: 0, progress: 'preparing', preparation,
            provenance: 'machine-created', retention: 'assigned', content: null, lastWriter: null,
          });
          result.push(id);
        }
        this.addReferences(state, resolved, result, requestedPurpose);
        return result;
      });
      for (const id of prepared) this.recoverCreation(id);
      return this.inspectAssignments();
    }
    for (const device of selected) requireCompatible(discovery.requirement, device.observation);
    if (new Set(selected.map((item) => item.selectionKey)).size !== selected.length) fail('INVALID_ARGUMENT', 'duplicate device selections');
    this.change((state, resolved) => {
      const ids = selected.map((device) => {
        let instance = state.instances.find((item) => item.providerId === device.observation.providerId);
        if (!instance) {
          instance = {
            id: `ios-${randomBytes(12).toString('hex')}`, kind: RESOURCE_KIND,
            providerId: device.observation.providerId, displayName: device.observation.name,
            revision: 0, progress: 'present', provenance: 'external',
            retention: 'user-retained', content: null, lastWriter: null,
          };
          state.instances.push(instance);
        }
        return instance.id;
      });
      this.addReferences(state, resolved, ids, requestedPurpose);
    });
    return this.inspectAssignments();
  }

  addReferences(state, resolved, ids, purpose) {
    const profile = resolved.profile.profile;
    let assignment = state.assignments.find((item) => item.profile === profile);
    if (!assignment) {
      assignment = { profile, profileSource: resolved.profile.profileFile, resources: [] };
      state.assignments.push(assignment);
    } else if (assignment.profileSource !== resolved.profile.profileFile) {
      fail('RESOURCE_PROFILE_AMBIGUOUS', 'same Profile ID resolves to different definition sources');
    }
    for (const id of ids) {
      const reference = assignment.resources.find((item) => item.id === id);
      if (reference) reference.purpose = purpose;
      else assignment.resources.push({ id, purpose });
    }
  }

  recoverCreation(id) {
    // Registry lock spans the provider create/readback so concurrent retries
    // cannot create two devices for one persisted preparation.
    return this.change((state) => {
      const instance = state.instances.find((item) => item.id === id);
      if (!instance) fail('RESOURCE_NOT_FOUND', 'unknown preparation resource');
      if (instance.progress === 'present') return instance;
      if (instance.progress !== 'preparing') fail('RESOURCE_RECOVERY_BLOCKED', 'resource is not preparing');
      const observation = this.provider.create(instance.preparation);
      requireCompatible(instance.preparation, observation);
      instance.providerId = observation.providerId;
      instance.progress = 'present';
      instance.revision += 1;
      instance.lastObservation = observation;
      return instance;
    });
  }

  inspectAssignments() {
    const resolved = this.admit();
    const state = readResourceState(this.options);
    const assignment = state.assignments.find((item) => item.profile === resolved.profile.profile);
    return {
      profile: resolved.profile.profile,
      devices: (assignment?.resources ?? []).map((ref) => {
        const instance = state.instances.find((item) => item.id === ref.id);
        return { ...this.projection(state, instance,
          instance.providerId ? this.provider.inspect(instance.providerId, instance.content?.bundleId) : null), purpose: ref.purpose };
      }),
    };
  }

  binding(selector) {
    const resolved = this.admit();
    const instance = assignedResource(this.options, resolved, selector);
    const state = readResourceState(this.options);
    const observation = this.provider.inspect(instance.providerId, instance.content?.bundleId);
    const requirement = iosRequirement(resolved.profile);
    requireCompatible(requirement, observation);
    if (requirement.data === 'fresh' && (instance.provenance !== 'machine-created' || instance.content !== null)) {
      fail('RESOURCE_FRESH_STATE_REQUIRED', 'this Profile requires an empty owned device; explicitly select a fresh device or request an exact reset', {
        device: this.projection(state, instance, observation), requirement,
      });
    }
    return { ...this.projection(state, instance, observation), requirement, profile: resolved.profile.profile, source: this.source(resolved) };
  }

  detach(id) {
    return this.change((state, resolved) => {
      const assignment = state.assignments.find((item) => item.profile === resolved.profile.profile);
      if (!assignment?.resources.some((item) => item.id === id)) fail('RESOURCE_NOT_ASSIGNED', 'resource is not assigned to this Profile');
      if (state.operations.some((item) => item.resourceId === id && item.profile === resolved.profile.profile &&
          ['ready', 'running'].includes(item.status))) fail('RESOURCE_OPERATION_ACTIVE', 'finish or cancel the operation before detaching');
      if (this.leases().some((item) => item.resourceKind === RESOURCE_KIND &&
          item.resourceId === state.instances.find((item) => item.id === id).providerId)) {
        fail('PHYSICAL_RESOURCE_CONFLICT', 'device has an OS-held lease; detach after its release');
      }
      assignment.resources = assignment.resources.filter((item) => item.id !== id);
      return { detached: id, deleted: false };
    });
  }

  impact(state, instance, target, action) {
    const observation = this.provider.inspect(instance.providerId, target?.bundleId ?? instance.content?.bundleId);
    const projection = this.projection(state, instance, observation);
    return {
      resourceId: instance.id, providerId: instance.providerId,
      name: instance.displayName, model: observation.model, runtime: observation.runtimeName,
      revision: instance.revision, sharedProfiles: projection.sharedProfiles,
      holders: projection.holders
        .filter((item) => item.leaseId !== process.env.PT_MACHINE_LEASE_ID)
        .map(({ acquiredAt, expiresAt, ...identity }) => identity),
      currentContent: instance.content, observedInstallation: observation.installed ?? null,
      providerState: observation.state, sessions: observation.sessions ?? [],
      targetContent: target, action,
      dataImpact: ['reset', 'delete'].includes(action)
        ? 'All applications, databases, credentials and Keychain on this device are removed.'
        : 'Install replaces this app; existing app data and Keychain are preserved. Active sessions may be interrupted.',
    };
  }

  propose({ resourceId, selector, action, target = null, appPath } = {}) {
    if (!RESOURCE_ACTIONS.has(action)) fail('INVALID_ARGUMENT', 'unsupported resource action');
    validateResourceTarget(target);
    const resolved = this.admit();
    if (['install', 'use'].includes(action)) {
      resourceText(target?.bundleId, 'bundleId');
      target = { ...target, source: target?.source ?? this.source(resolved) };
      validateResourceTarget(target);
      if (resourceDigest(target.source) !== resourceDigest(this.source(resolved))) {
        fail('RUNTIME_IDENTITY_MISMATCH', 'target source differs from the current workspace');
      }
    }
    const instance = assignedResource(this.options, resolved, resourceId ?? selector);
    if (['reset', 'delete'].includes(action) && resolved.profile.resetPolicy === 'stable-protected') {
      fail('PROFILE_RESET_PROTECTED', 'stable Profile device destruction is protected');
    }
    const observed = this.provider.inspect(instance.providerId);
    if (observed.exists || action !== 'delete') requireCompatible(iosRequirement(resolved.profile), observed);
    if (action === 'install') {
      resourceText(appPath, 'appPath');
      resourceText(target?.bundleId, 'bundleId');
      target = { ...target, artifactDigest: appArtifactDigest(appPath) };
    }
    return this.change((state, current) => {
      const resource = state.instances.find((item) => item.id === instance.id);
      if (resource.activeOperation) fail('RESOURCE_RECOVERY_REQUIRED', 'reconcile the interrupted operation before another mutation');
      if (!['present', 'cleanup-failed'].includes(resource.progress)) fail('RESOURCE_RECOVERY_BLOCKED', 'reconcile resource progress before use');
      const impact = this.impact(state, resource, target, action);
      const { verified, ...currentBinding } = resource.content ?? {};
      if (action === 'use' && !target?.artifactDigest) delete currentBinding.artifactDigest;
      const sameContent = resourceDigest(resource.content === null ? null : currentBinding) === resourceDigest(target);
      const changesContent = ['install', 'use'].includes(action) && !sameContent;
      const knownEmpty = resource.provenance === 'machine-created' && resource.content === null && !impact.observedInstallation;
      const requiresDecision = ['reset', 'delete'].includes(action) ||
        ((changesContent || (target?.artifactDigest && impact.observedInstallation?.artifactDigest !== target.artifactDigest)) &&
          (!knownEmpty || resource.provenance === 'external')) ||
        (action === 'install' && impact.sessions.length > 0);
      const operation = {
        id: randomBytes(16).toString('hex'), resourceId: resource.id, providerId: resource.providerId,
        profile: current.profile.profile, workspaceId: current.binding.workspaceId,
        source: this.source(current), action, target, appPath: appPath ?? null,
        impact, impactDigest: resourceDigest(impact),
        status: requiresDecision ? 'pending' : 'ready', decision: null,
        createdAt: new Date().toISOString(),
      };
      state.operations.push(operation);
      return operation;
    });
  }

  decide(operationId, decision, impactDigest) {
    if (!['force', 'decline', 'cancel'].includes(decision)) fail('INVALID_ARGUMENT', 'decision must be force, decline or cancel');
    return this.change((state, resolved) => {
      const operation = state.operations.find((item) => item.id === operationId);
      this.requireOperation(operation, resolved);
      if (!((operation.status === 'pending') || (decision === 'cancel' && operation.status === 'ready')) ||
          operation.impactDigest !== impactDigest) {
        fail('RESOURCE_DECISION_STALE', 'decision must match this pending operation and its displayed impact');
      }
      operation.decision = decision;
      operation.status = decision === 'force' ? 'ready' : decision === 'decline' ? 'declined' : 'cancelled';
      return operation;
    });
  }

  requireOperation(operation, resolved) {
    if (!operation || operation.profile !== resolved.profile.profile ||
        operation.workspaceId !== resolved.binding.workspaceId) fail('RESOURCE_OPERATION_MISMATCH', 'operation belongs to a different workspace/Profile');
    if (resourceDigest(operation.source) !== resourceDigest(this.source(resolved))) fail('RUNTIME_IDENTITY_MISMATCH', 'operation source changed');
  }

  begin(operationId) {
    const prepared = readResourceState(this.options).operations.find((item) => item.id === operationId);
    if (!prepared) fail('RESOURCE_OPERATION_MISMATCH', 'unknown operation');
    this.verifyLease({ providerId: prepared.providerId });
    const result = this.change((state, resolved) => {
      const operation = state.operations.find((item) => item.id === operationId);
      this.requireOperation(operation, resolved);
      if (operation.status !== 'ready') fail('RESOURCE_DECISION_REQUIRED', 'operation is not ready; show its overwrite notice first');
      const instance = state.instances.find((item) => item.id === operation.resourceId);
      if (instance.activeOperation) fail('RESOURCE_OPERATION_ACTIVE', 'another operation is already running on this device');
      if (!state.assignments.find((item) => item.profile === operation.profile)?.resources.some((item) => item.id === instance.id)) {
        fail('RESOURCE_NOT_ASSIGNED', 'operation resource was detached');
      }
      const impact = this.impact(state, instance, operation.target, operation.action);
      // This operation's newly acquired holder is not a change to user impact.
      impact.holders = impact.holders.filter((item) => item.workspaceId !== operation.workspaceId ||
        item.leaseId !== process.env.PT_MACHINE_LEASE_ID);
      if (resourceDigest(impact) !== operation.impactDigest) {
        operation.impact = impact;
        operation.impactDigest = resourceDigest(impact);
        operation.decision = null;
        operation.status = 'pending';
        return { changed: true, operation };
      }
      const observed = this.provider.inspect(instance.providerId);
      if (observed.exists || operation.action !== 'delete') requireCompatible(iosRequirement(resolved.profile), observed);
      if (operation.action === 'install' && appArtifactDigest(operation.appPath) !== operation.target.artifactDigest) {
        fail('RESOURCE_ARTIFACT_CHANGED', 'installation artifact changed after preparation');
      }
      if (operation.action === 'install') this.verifyNativeTarget(operation.appPath, operation.target);
      operation.status = 'running';
      instance.progress = operation.action === 'delete' ? 'removing' : 'present';
      instance.activeOperation = operation.id;
      instance.revision += 1;
      return { changed: false, operation };
    });
    if (result.changed) fail('RESOURCE_DECISION_STALE', 'device, sharing, content or sessions changed after notice; show the new notice', result.operation);
    return result.operation;
  }

  installDuringUse(operationId, appPath) {
    const prepared = readResourceState(this.options).operations.find((item) => item.id === operationId);
    if (!prepared) fail('RESOURCE_OPERATION_MISMATCH', 'unknown runtime operation');
    this.verifyLease({ providerId: prepared.providerId });
    return this.change((state, resolved) => {
      const operation = state.operations.find((item) => item.id === operationId);
      this.requireOperation(operation, resolved);
      const instance = state.instances.find((item) => item.id === operation.resourceId);
      if (operation.action !== 'use' || operation.status !== 'running' || instance.activeOperation !== operation.id) {
        fail('RESOURCE_OPERATION_MISMATCH', 'installation requires the active, admitted runtime operation');
      }
      const references = this.projection(state, instance).sharedProfiles;
      if (resourceDigest(references) !== resourceDigest(operation.impact.sharedProfiles)) {
        fail('RESOURCE_DECISION_STALE', 'Profile sharing changed during the build; reconcile and show a new impact before installation');
      }
      const bundleId = this.provider.bundleIdentity(appPath);
      if (bundleId !== operation.target?.bundleId) fail('RESOURCE_ARTIFACT_INVALID', 'built app bundle does not match the displayed target');
      this.verifyNativeTarget(appPath, operation.target);
      const digest = appArtifactDigest(appPath);
      this.provider.install(instance.providerId, appPath);
      const observation = this.provider.inspect(instance.providerId, bundleId);
      if (observation.installed?.artifactDigest !== digest) fail('RESOURCE_INSTALL_UNVERIFIED', 'installed runtime differs from the built app');
      operation.installedTarget = { ...operation.target, artifactDigest: digest };
      instance.content = { ...operation.installedTarget, verified: true };
      instance.lastObservation = observation;
      return this.projection(state, instance, observation);
    });
  }

  verifyNativeTarget(appPath, target) {
    const identity = this.provider.nativeIdentity(appPath);
    if (identity.sourceCommit !== target.source.head || identity.workspaceDigest !== target.source.workspaceDigest ||
        identity.applicationId !== target.bundleId || identity.platform !== 'ios') {
      fail('RESOURCE_NATIVE_IDENTITY_UNPROVEN', 'native build source or bundle differs from the admitted target', { identity, target });
    }
    if (target.devUrl && identity.buildInputsDigest !== resourceDigestEndpoint(target)) {
      fail('RESOURCE_NATIVE_IDENTITY_UNPROVEN', 'native development endpoint differs from the admitted target');
    }
    return identity;
  }

  buildIdentity(operationId) {
    const resolved = this.admit();
    const operation = readResourceState(this.options).operations.find((item) => item.id === operationId);
    this.requireOperation(operation, resolved);
    this.verifyLease({ providerId: operation.providerId });
    if (operation.action !== 'use' || operation.status !== 'running') {
      fail('RESOURCE_OPERATION_MISMATCH', 'build identity requires the admitted runtime operation');
    }
    // The original Mobile producer owns the schema and validation. Pass exact
    // observed inputs; ordinary development never enables Acceptance Harness.
    const inputs = {
      build_id: operation.id, platform: 'ios', configuration: 'development',
      source: {
        source_commit: operation.source.head,
        workspace_state: operation.source.workspaceDigest === 'clean' ? 'clean' : 'dirty',
        workspace_digest: operation.source.workspaceDigest,
      },
      build_inputs_digest: resourceDigestEndpoint(operation.target),
      environment_digest: `sha256:${resourceDigest({})}`,
      application_id: operation.target.bundleId,
    };
    return JSON.parse(execFileSync(process.env.PT_MACHINE_DEV_PYTHON ?? 'python3', [
      '-B', '-c',
      'import json,sys; from tooling.acceptance.provisioners.mobile_native_build import SourceIdentity,create_build_identity; v=json.load(sys.stdin); v["source"]=SourceIdentity(**v["source"]); sys.stdout.write(json.dumps(create_build_identity(**v),sort_keys=True,separators=(",",":"))+chr(10))',
    ], {
      cwd: resolved.binding.canonicalRoot, input: JSON.stringify(inputs),
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000,
    }));
  }

  checkDevEndpoint(providerId, devUrl) {
    this.admit();
    const users = this.provider.devEndpointUsers(devUrl).filter((item) => item.providerId !== providerId);
    if (users.length) fail('RESOURCE_ENDPOINT_CONFLICT', 'another installed simulator app uses this development endpoint; preserve its server and choose an isolated workspace slot', { devUrl, users });
    return { devUrl, foreignUsers: [] };
  }

  finish(operationId, error = null) {
    const prepared = readResourceState(this.options).operations.find((item) => item.id === operationId);
    if (!prepared) fail('RESOURCE_OPERATION_MISMATCH', 'unknown operation');
    this.verifyLease({ providerId: prepared.providerId });
    return this.change((state, resolved) => {
      const operation = state.operations.find((item) => item.id === operationId);
      this.requireOperation(operation, resolved);
      if (operation.status !== 'running') fail('RESOURCE_OPERATION_MISMATCH', 'operation is not running');
      const instance = state.instances.find((item) => item.id === operation.resourceId);
      let observation;
      try {
        observation = this.provider.inspect(instance.providerId, operation.target?.bundleId ?? instance.content?.bundleId);
        if (!error && operation.action === 'delete' && (observation.exists || observation.directoryExists)) {
          error = new Error('provider device or associated directory still exists');
        }
        if (!error && operation.action === 'install' &&
            observation.installed?.artifactDigest !== operation.target.artifactDigest) {
          error = new Error('installed app artifact digest does not match target');
        }
        if (!error && operation.action === 'use' &&
            (!operation.installedTarget || observation.installed?.artifactDigest !== operation.installedTarget.artifactDigest)) {
          error = new Error('runtime installation has no matching provider readback');
        }
      } catch (readbackError) {
        error ??= readbackError;
      }
      operation.status = error ? 'failed' : 'succeeded';
      operation.error = error ? String(error.message ?? error) : null;
      operation.finishedAt = new Date().toISOString();
      instance.lastObservation = observation ?? null;
      instance.lastWriter = { operationId, profile: operation.profile, workspaceId: operation.workspaceId, source: operation.source };
      instance.content = error ? { verified: false, observedInstallation: observation?.installed ?? null }
        : ['delete', 'reset'].includes(operation.action) ? null
          : operation.action === 'boot' ? instance.content
            : operation.installedTarget ? { ...operation.installedTarget, verified: true }
              : operation.target ? { ...operation.target, verified: operation.action === 'install' } : instance.content;
      instance.progress = operation.action === 'delete'
        ? error ? 'cleanup-failed' : 'removed' : 'present';
      instance.revision += 1;
      delete instance.activeOperation;
      return this.projection(state, instance, observation);
    });
  }

  // Reclaim provider-orphaned simulators: physical devices that no longer have
  // a machine document instance (discovery marks them `external`) and carry the
  // tool's naming signature. This is the only deletion path that touches
  // devices outside the assignment/operation contracts, so it fails closed:
  // booted devices, active lease holders, non-machine names and every managed
  // (documented) instance are reported as protected and never deleted.
  sweep({ selector, confirm = false } = {}) {
    const discovery = this.discover();
    const managed = [];
    const candidates = [];
    const protectedDevices = [];
    for (const device of discovery.devices) {
      if (device.progress !== 'external') {
        managed.push(this.sweepEntry(device));
        continue;
      }
      const reason = this.sweepBlockReason(device);
      if (reason) {
        protectedDevices.push({ ...this.sweepEntry(device), reason });
      } else {
        candidates.push(device);
      }
    }
    let scoped = candidates;
    if (selector !== undefined) {
      const matches = candidates.filter((item) =>
        item.name === selector || item.observation.name === selector);
      if (matches.length !== 1) {
        fail('RESOURCE_SWEEP_SELECTION', 'selector must match exactly one sweep candidate; run the dry run to see names', {
          selector,
          candidates: candidates.map((item) => item.name),
        });
      }
      scoped = matches;
    }
    const report = {
      mode: confirm ? 'confirm' : 'dry-run',
      signaturePrefix: MACHINE_DEVICE_NAME_PREFIX,
      managed,
      protected: protectedDevices,
      candidates: scoped.map((item) => this.sweepEntry(item)),
      deleted: [],
    };
    if (!confirm) return report;
    // External devices have no machine document entry, so provider deletion is
    // the only mutation; the registry stays truthful because discover() simply
    // stops listing a removed provider device. provider.delete already shuts
    // down, removes and readbacks, failing the whole sweep on any mismatch.
    for (const device of scoped) {
      const providerId = device.observation.providerId;
      this.provider.delete(providerId);
      report.deleted.push(this.sweepEntry(device));
    }
    return report;
  }

  sweepBlockReason(device) {
    if (!device.observation.name.startsWith(MACHINE_DEVICE_NAME_PREFIX)) return 'not-machine-named';
    if (device.holders.length > 0) return 'active-lease';
    if (device.observation.state === 'Booted') return 'booted';
    return null;
  }

  sweepEntry(device) {
    return {
      name: device.observation.name,
      providerId: device.observation.providerId,
      model: device.observation.model,
      runtime: device.observation.runtimeName,
      state: device.observation.state,
      progress: device.progress,
      sharedProfiles: device.sharedProfiles,
      holders: device.holders,
    };
  }

  recoverOperation(operationId) {
    const prepared = readResourceState(this.options).operations.find((item) => item.id === operationId);
    if (!prepared) fail('RESOURCE_OPERATION_MISMATCH', 'unknown interrupted operation');
    this.verifyLease({ providerId: prepared.providerId });
    return this.change((state, resolved) => {
      const operation = state.operations.find((item) => item.id === operationId);
      if (operation.profile !== resolved.profile.profile || operation.workspaceId !== resolved.binding.workspaceId) {
        fail('RESOURCE_OPERATION_MISMATCH', 'recovery belongs to a different workspace/Profile');
      }
      const instance = state.instances.find((item) => item.id === operation.resourceId);
      if (operation.status !== 'running') return this.projection(state, instance);
      const observation = this.provider.inspect(instance.providerId, operation.target?.bundleId);
      const removed = operation.action === 'delete' && !observation.exists && !observation.directoryExists;
      operation.status = removed ? 'succeeded' : 'failed';
      operation.error = removed ? null : 'Interrupted mutation reconciled from provider; a new operation and decision are required to retry.';
      instance.progress = removed ? 'removed' : operation.action === 'delete' ? 'cleanup-failed' : 'present';
      instance.content = removed ? null : { verified: false, observedInstallation: observation.installed ?? null };
      instance.lastObservation = observation;
      instance.revision += 1;
      delete instance.activeOperation;
      return this.projection(state, instance, observation);
    });
  }
}
