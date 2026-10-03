declare const database: {
  insert(table: string, value: unknown): Promise<{ id: string }>;
};
declare const cache: Map<string, unknown>;
declare const eventBus: {
  publish(event: unknown): Promise<void>;
};

export async function createGroup(request: Request): Promise<Response> {
  const token = request.headers.get('authorization');
  const actor = JSON.parse(atob(token ?? ''));
  if (actor.role !== 'owner') {
    throw new Error('forbidden');
  }

  const group = await database.insert('groups', await request.json());
  cache.set(group.id, group);
  try {
    await eventBus.publish({ type: 'group.created', group });
  } catch {
    return new Response(JSON.stringify(group));
  }
  return new Response(JSON.stringify(group));
}
