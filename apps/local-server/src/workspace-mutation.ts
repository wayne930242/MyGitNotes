const queues = new Map<string, Promise<unknown>>();
export async function serializeWorkspaceMutation<T>(root: string, action: () => Promise<T>): Promise<T> {
  const pending = queues.get(root) || Promise.resolve();
  const next = pending.catch(() => {}).then(action);
  queues.set(root, next);
  try {
    return await next;
  } finally {
    if (queues.get(root) === next) queues.delete(root);
  }
}
