/** Device-local media admission. Pending capture keeps its lease until cleanup. */
export class MediaReservation {
  private current: { owner: 'direct' | 'group'; attemptId: string } | null = null;

  acquire(owner: 'direct' | 'group', attemptId: string): () => void {
    if (this.current) throw new Error('call.mediaAlreadyOccupied');
    const lease = { owner, attemptId };
    this.current = lease;
    return () => {
      if (this.current === lease) this.current = null;
    };
  }

  isOccupied(): boolean {
    return this.current !== null;
  }
}
