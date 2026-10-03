type CreateGroup = {
  actorId: string;
  name: string;
};

type Group = {
  id: string;
  name: string;
};

interface GroupPolicy {
  assertCanCreate(actorId: string): Promise<void>;
}

interface GroupCreation {
  createWithDurableEvent(command: CreateGroup): Promise<Group>;
}

export class CreateGroupService {
  constructor(
    private readonly policy: GroupPolicy,
    private readonly groups: GroupCreation,
  ) {}

  async execute(command: CreateGroup): Promise<Group> {
    await this.policy.assertCanCreate(command.actorId);
    return this.groups.createWithDurableEvent(command);
  }
}
