// Native fault driver: production admission, storage, locks and simctl provider.
// A child exits at one boundary; no production fault flag or alternate registry.
import { readFileSync } from 'node:fs';
import { MachineResourceOwner } from '../machine-dev-resource-store.mjs';
import { readResourceState } from '../machine-dev-resource-contract.mjs';
import { IOSResourceProvider } from '../machine-dev-ios-provider.mjs';

const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const options = { workspaceRoot: request.workspaceRoot, targetProfile: request.profile };
if (!/^[a-f0-9]{12}$/.test(request.tag) ||
    ![`res-${request.tag}-a`, `res-${request.tag}-b`].includes(request.profile)) {
  throw new Error('Native boundary driver requires its exact fixture Profile');
}
const provider = new IOSResourceProvider();
const owner = new MachineResourceOwner(options, { provider });
owner.admit();
if (['preparation', 'create'].includes(request.phase)) {
  if (request.phase === 'preparation') owner.recoverCreation = () => process.exit(86);
  else {
    const create = provider.create.bind(provider);
    provider.create = (intent) => {
      create(intent);
      process.exit(86);
    };
  }
  owner.assign({ count: 2, purpose: `Resource proof ${request.tag}`, create: true,
    preparationId: `res-${request.tag}` });
} else {
  const state = readResourceState();
  const operation = state.operations.find((item) => item.id === request.operationId);
  const instance = state.instances.find((item) => item.id === operation?.resourceId);
  if (!instance || instance.preparation?.requestId !== `res-${request.tag}` ||
      instance.provenance !== 'machine-created' || operation.action !== 'install') {
    throw new Error('Native install fault cannot target a non-fixture device');
  }
  owner.begin(operation.id);
  if (request.phase === 'install-begin') process.exit(86);
  if (request.phase !== 'install-provider') throw new Error('Unknown native fault boundary');
  provider.install(instance.providerId, operation.appPath);
  process.exit(86);
}
throw new Error('Native fault boundary was not reached');
