export interface ReconnectManager {
  getAttempt(): number;
  reset(): void;
  cancel(): void;
  schedule(task: () => void): number;
}

export function createReconnectManager(delaysMs: number[]): ReconnectManager {
  const delays = delaysMs.length > 0 ? delaysMs : [1_000, 3_000, 5_000, 10_000];
  let attempt = 0;
  let timer: NodeJS.Timeout | null = null;

  return {
    getAttempt() {
      return attempt;
    },
    reset() {
      attempt = 0;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    schedule(task) {
      if (timer) {
        clearTimeout(timer);
      }

      const delay = delays[Math.min(attempt, delays.length - 1)] ?? delays[delays.length - 1] ?? 1_000;
      attempt += 1;
      timer = setTimeout(() => {
        timer = null;
        task();
      }, delay);
      return delay;
    },
  };
}
