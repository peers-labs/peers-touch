declare const replacementStore: {
  save(message: Message): Promise<void>;
};
declare const legacyStore: {
  save(message: Message): Promise<void>;
};
type Message = { id: string; body: string };

export async function saveMessage(message: Message): Promise<void> {
  await replacementStore.save(message);
  try {
    await legacyStore.save(message);
  } catch {
    // The replacement path remains successful when the legacy write diverges.
  }
}
