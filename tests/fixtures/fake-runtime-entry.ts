import { loadAppConfig } from '../../src/config/app-config.js';
import { startRuntime, type RuntimeTransportFactory } from '../../src/runtime/runtime-service.js';

const holdTransportFactory: RuntimeTransportFactory = async ({ runtimeStateStore }) => {
  await runtimeStateStore.syncDerivedState();
  await runtimeStateStore.update({
    connectionState: 'connecting',
    qrState: 'not_requested',
    qrOpenedInPaint: false,
    lastError: null,
  });

  let resolveStopped: () => void = () => {};
  const untilStopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const keepAlive = setInterval(() => undefined, 60_000);

  return {
    untilStopped,
    async stop() {
      clearInterval(keepAlive);
      await runtimeStateStore.update({
        connectionState: 'idle',
        qrState: 'not_requested',
      });
      resolveStopped();
    },
  };
};

const config = loadAppConfig();
const runtime = await startRuntime(config, {
  transportFactory: holdTransportFactory,
});

await runtime.untilStopped;
