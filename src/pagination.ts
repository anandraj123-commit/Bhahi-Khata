export const PAGE_SIZE = 15;

/** Allows one page advance for each actual user drag, never for mount/layout events. */
export class UserScrollPageGate {
  private scrollSequence = 0;
  private consumedSequence = 0;
  private userMoved = false;

  beginUserScroll() {
    this.scrollSequence += 1;
    this.userMoved = false;
  }

  markUserMovement() {
    this.userMoved = true;
  }

  claimPage() {
    if (!this.userMoved || this.scrollSequence <= this.consumedSequence) return false;
    this.consumedSequence = this.scrollSequence;
    this.userMoved = false;
    return true;
  }

  reset() {
    this.scrollSequence = 0;
    this.consumedSequence = 0;
    this.userMoved = false;
  }
}

export function nextVisibleCount(currentCount: number, total: number, pageSize = PAGE_SIZE) {
  return Math.min(Math.max(0, currentCount) + pageSize, Math.max(0, total));
}

export function visiblePage<T>(items: T[], visibleCount: number) {
  const count = Math.max(0, visibleCount);
  return {
    items: items.slice(0, count),
    hasMore: items.length > count,
  };
}
