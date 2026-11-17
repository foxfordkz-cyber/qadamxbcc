/** User selection is independent of the last transfer attempt being reconciled. */
export class TransferSelection {
  id: string | null = null;
  private canRestore = true;

  select(id: string | null) {
    this.id = id;
    this.canRestore = false;
  }

  /** Restore once on startup; later reads may refresh only the chosen transfer. */
  acceptsRecovery(id: string): boolean {
    if (this.id === id) return true;
    if (!this.canRestore) return false;
    this.select(id);
    return true;
  }
}
