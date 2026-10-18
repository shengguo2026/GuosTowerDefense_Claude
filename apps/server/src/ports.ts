import { createServer } from 'node:net';

/** Finds the first free port from `start` upward (3000, 3001, …), as the launcher does (spec §3). */
export async function findFreePort(start: number, host: string, attempts = 50): Promise<number> {
  for (let port = start; port < start + attempts; port++) {
    if (await isFree(port, host)) return port;
  }
  throw new Error(`No free port between ${start} and ${start + attempts - 1}.`);
}

function isFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}
