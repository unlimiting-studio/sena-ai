type SignalHandler = (signal: NodeJS.Signals) => Promise<void>;

type SignalRouterHandle = {
  dispose: () => void;
};

const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

export const installSignalRouter = (handler: SignalHandler): SignalRouterHandle => {
  let disposed = false;
  let shuttingDown = false;
  const listeners = new Map<NodeJS.Signals, () => void>();

  for (const signal of SIGNALS) {
    const listener = (): void => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      void handler(signal).catch((error) => {
        const message = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
        console.error(`[orchestrator] shutdown failed (${signal})`, message);
        process.exit(1);
      });
    };
    listeners.set(signal, listener);
    process.once(signal, listener);
  }

  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const [signal, listener] of listeners) {
        process.off(signal, listener);
      }
      listeners.clear();
    },
  };
};
