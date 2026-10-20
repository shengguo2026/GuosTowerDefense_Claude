import type { Server } from 'node:http';
import { createServer, type Server as NetServer, type Socket } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/** Adapter names that are rarely the Wi-Fi a phone is in: virtual machines, containers, VPNs. */
const VIRTUAL_ADAPTER =
  /vEthernet|VirtualBox|VMware|Hyper-V|Docker|WSL|vboxnet|docker|br-|veth|utun|tun|tap|Loopback/i;
const WIRELESS_ADAPTER = /Wi-?Fi|WLAN|Wireless|wlan|wlp|^en0$/i;

/**
 * The PC's IPv4 addresses that a phone or tablet in the same network can reach, best guess first: Wi-Fi adapters,
 * then other private addresses, with virtual adapters and self-assigned (169.254.x.x) addresses last or left out.
 */
export function lanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const found: { address: string; rank: number }[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const net of entries ?? []) {
      if (net.family !== 'IPv4' || net.internal || net.address.startsWith('169.254.')) continue;
      const rank =
        (VIRTUAL_ADAPTER.test(name) ? 4 : 0) +
        (WIRELESS_ADAPTER.test(name) ? 0 : 1) +
        (isPrivate(net.address) ? 0 : 2);
      if (!found.some((entry) => entry.address === net.address)) found.push({ address: net.address, rank });
    }
  }
  return found.sort((a, b) => a.rank - b.rank).map((entry) => entry.address);
}

function isPrivate(address: string): boolean {
  const [a, b] = address.split('.').map(Number) as [number, number];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** A request from this PC itself (its own browser), as opposed to a phone or tablet in the network. */
export function isLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const address = remoteAddress.replace(/^::ffff:/, '');
  return address === '::1' || address.startsWith('127.');
}

/**
 * Opens the running game to phones and tablets in the same network (spec §3). The game server itself listens only on
 * this PC (127.0.0.1), so Windows asks no firewall question at start; sharing adds a listener on each network address
 * of the PC, on the same port, that hands its connections to the game server. Windows asks its firewall question the
 * first time this happens, which is why the game explains it first.
 */
export class LanSharing {
  private listeners: NetServer[] = [];
  private readonly guests = new Set<Socket>();
  private port = 0;
  /** Addresses that could not be opened on the last start (for example because another program uses the port). */
  failed: string[] = [];

  constructor(private readonly addresses: () => string[] = () => lanAddresses()) {}

  /** Sharing is on (even if no address could be opened). */
  get active(): boolean {
    return this.port > 0;
  }

  /** The addresses phones and tablets can open now. */
  get open(): string[] {
    return this.listeners.map((listener) => (listener as NetServer & { gtdAddress: string }).gtdAddress);
  }

  /** Starts sharing on every network address, or adds addresses that appeared since (a new Wi-Fi, for example). */
  async start(server: Server, port: number): Promise<void> {
    this.port = port;
    const open = new Set(this.open);
    this.failed = [];
    for (const address of this.addresses()) {
      if (open.has(address)) continue;
      const listener = createServer((socket) => {
        this.guests.add(socket);
        socket.once('close', () => this.guests.delete(socket));
        server.emit('connection', socket);
      }) as NetServer & { gtdAddress: string };
      listener.gtdAddress = address;
      const ok = await new Promise<boolean>((resolve) => {
        listener.once('error', () => resolve(false));
        listener.listen(port, address, () => resolve(true));
      });
      if (ok) this.listeners.push(listener);
      else this.failed.push(address);
    }
  }

  /** Stops sharing and disconnects every phone and tablet. */
  async stop(): Promise<void> {
    const listeners = this.listeners.splice(0);
    this.port = 0;
    this.failed = [];
    for (const socket of this.guests) socket.destroy();
    this.guests.clear();
    await Promise.all(listeners.map((listener) => new Promise((resolve) => listener.close(resolve))));
  }
}
