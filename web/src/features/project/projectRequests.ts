// Owns read requests for one mounted project panel. Keys allow independent
// files/diffs to load together, while replacement and context changes abort
// obsolete work rather than just ignoring its result.
export class ProjectRequests {
  private pending = new Map<string, AbortController>()
  epoch = 0

  start(key: string) {
    this.cancel(key)
    const controller = new AbortController()
    this.pending.set(key, controller)
    return controller
  }

  current(key: string, controller: AbortController) {
    return !controller.signal.aborted && this.pending.get(key) === controller
  }

  finish(key: string, controller: AbortController) {
    if (this.pending.get(key) === controller) this.pending.delete(key)
  }

  cancel(key: string) {
    this.pending.get(key)?.abort()
    this.pending.delete(key)
  }

  cancelPrefix(prefix: string) {
    for (const key of this.pending.keys())
      if (key.startsWith(prefix)) this.cancel(key)
  }

  clear() {
    this.epoch++
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
  }
}
