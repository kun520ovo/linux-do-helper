// Each feature owns the listeners, observers and timers it creates.
export class DisposableScope {
  constructor() {
    this.disposed = false;
    this.cleanups = new Set();
    this.timeouts = new Set();
    this.intervals = new Set();
  }

  add(cleanup) {
    if (this.disposed) cleanup();
    else this.cleanups.add(cleanup);
    return cleanup;
  }

  listen(target, type, callback, options) {
    if (this.disposed) return;
    target.addEventListener(type, callback, options);
    return this.add(() => target.removeEventListener(type, callback, options));
  }

  setTimeout(callback, delay) {
    if (this.disposed) return null;
    const id = setTimeout(() => {
      this.timeouts.delete(id);
      if (!this.disposed) callback();
    }, delay);
    this.timeouts.add(id);
    return id;
  }

  clearTimeout(id) {
    clearTimeout(id);
    this.timeouts.delete(id);
  }

  setInterval(callback, delay) {
    if (this.disposed) return null;
    const id = setInterval(() => {
      if (!this.disposed) callback();
    }, delay);
    this.intervals.add(id);
    return id;
  }

  clearInterval(id) {
    clearInterval(id);
    this.intervals.delete(id);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.timeouts) clearTimeout(id);
    for (const id of this.intervals) clearInterval(id);
    for (const cleanup of this.cleanups) cleanup();
    this.timeouts.clear();
    this.intervals.clear();
    this.cleanups.clear();
  }
}
