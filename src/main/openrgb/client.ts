import net from 'node:net';
import { EventEmitter } from 'node:events';
import {
  Packet, HEADER_SIZE, DEFAULT_PORT, CLIENT_PROTOCOL_VERSION,
  Controller, decodeHeader, decodeController, encodePacket,
  buildClientName, buildProtocolVersion, buildUpdateLeds,
  buildUpdateZoneLeds, buildUpdateMode, buildResizeZone, findDirectMode,
} from './protocol.js';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

interface Pending {
  packetId: number;
  deviceId: number;
  resolve: (data: Buffer) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * A single OpenRGB SDK connection.
 *
 * Two things this handles that a naive implementation gets wrong:
 *
 * 1. TCP is a stream, not a message queue. A single 'data' event can contain
 *    half a packet, three packets, or a packet split across events. Everything
 *    goes through an accumulating buffer and is only dispatched once a full
 *    header plus payload has arrived.
 *
 * 2. OpenRGB pushes DEVICE_LIST_UPDATED unprompted whenever hardware is
 *    hotplugged. That arrives interleaved with replies to our own requests, so
 *    request matching is by packet id rather than by arrival order.
 */
export class OpenRgbClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private inbox: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private pending: Pending[] = [];
  private retry = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private closing = false;

  state: ConnectionState = 'idle';
  protocol = 0;
  controllers: Controller[] = [];

  constructor(
    private host = '127.0.0.1',
    private port = DEFAULT_PORT,
    private clientName = 'Halo',
  ) { super(); }

  /* ---------------------------------------------------------------- */
  /* lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  async connect(): Promise<void> {
    this.closing = false;
    this.setState(this.retry > 0 ? 'reconnecting' : 'connecting');

    await new Promise<void>((resolve, reject) => {
      const sock = new net.Socket();
      sock.setNoDelay(true);

      const onError = (err: Error) => { sock.destroy(); reject(err); };
      sock.once('error', onError);

      sock.connect(this.port, this.host, () => {
        sock.off('error', onError);
        this.socket = sock;
        sock.on('data', (chunk) => this.onData(chunk));
        sock.on('error', (e) => this.emit('socket-error', e));
        sock.on('close', () => this.onClose());
        resolve();
      });
    });

    // Handshake. Name first so the device shows up in OpenRGB's client list.
    this.send(0, Packet.SET_CLIENT_NAME, buildClientName(this.clientName));

    try {
      const reply = await this.request(
        0, Packet.REQUEST_PROTOCOL_VERSION,
        buildProtocolVersion(CLIENT_PROTOCOL_VERSION), 2000,
      );
      const server = reply.length >= 4 ? reply.readUInt32LE(0) : 0;
      this.protocol = Math.min(server, CLIENT_PROTOCOL_VERSION);
    } catch {
      // Servers older than 0.5 never implemented packet 40 and simply do not
      // answer. Silence means protocol 0.
      this.protocol = 0;
    }

    this.retry = 0;
    this.setState('connected');
    await this.refreshControllers();
  }

  disconnect() {
    this.closing = true;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.socket?.destroy();
    this.socket = null;
    this.setState('idle');
  }

  get connected() { return this.state === 'connected' && !!this.socket && !this.socket.destroyed; }

  private setState(s: ConnectionState) {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', s);
  }

  private onClose() {
    this.socket = null;
    this.inbox = Buffer.alloc(0);
    for (const p of this.pending) { clearTimeout(p.timer); p.reject(new Error('socket closed')); }
    this.pending = [];
    if (this.closing) return;
    this.scheduleRetry();
  }

  /**
   * Exponential backoff, capped. OpenRGB crashes occasionally and comes
   * straight back, so the first few retries are fast.
   *
   * This has to be driven from here rather than from the socket's `close`
   * event: a refused connection never produces a `close` (the handler is only
   * attached once a connection succeeds), so scheduling from `close` alone
   * meant one failed attempt killed the retry chain for the life of the
   * process. Keep retrying past the point we start reporting `failed` —
   * OpenRGB is frequently started *after* Halo.
   */
  private scheduleRetry() {
    if (this.closing || this.retryTimer) return;
    const delay = Math.min(15000, 400 * 2 ** this.retry);
    this.retry++;
    this.setState(this.retry > 12 ? 'failed' : 'reconnecting');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect().catch(() => this.scheduleRetry());
    }, delay);
  }

  /**
   * Connect, and keep trying in the background if it fails. Rejects on the
   * first failure so the caller can surface it, but the retry chain lives on.
   */
  async connectWithRetry(): Promise<void> {
    try {
      await this.connect();
    } catch (e) {
      this.scheduleRetry();
      throw e;
    }
  }

  /* ---------------------------------------------------------------- */
  /* framing                                                          */
  /* ---------------------------------------------------------------- */

  private onData(chunk: Buffer) {
    this.inbox = this.inbox.length ? Buffer.concat([this.inbox, chunk]) : chunk;

    for (;;) {
      if (this.inbox.length < HEADER_SIZE) return;

      const header = decodeHeader(this.inbox);
      if (!header) {
        // Desync. Hunt for the next magic rather than dropping the connection.
        const next = this.inbox.indexOf('ORGB', 1, 'ascii');
        if (next < 0) { this.inbox = Buffer.alloc(0); return; }
        this.inbox = this.inbox.subarray(next);
        continue;
      }

      const total = HEADER_SIZE + header.dataSize;
      if (this.inbox.length < total) return; // payload still in flight

      const payload = this.inbox.subarray(HEADER_SIZE, total);
      this.inbox = this.inbox.subarray(total);
      this.dispatch(header.packetId, header.deviceId, Buffer.from(payload));
    }
  }

  private dispatch(packetId: number, deviceId: number, payload: Buffer) {
    if (packetId === Packet.DEVICE_LIST_UPDATED) {
      this.emit('devices-changed');
      return;
    }
    const i = this.pending.findIndex(
      (p) => p.packetId === packetId && (p.deviceId === deviceId || p.deviceId === -1),
    );
    if (i >= 0) {
      const [p] = this.pending.splice(i, 1);
      clearTimeout(p.timer);
      p.resolve(payload);
    }
  }

  /* ---------------------------------------------------------------- */
  /* transport                                                        */
  /* ---------------------------------------------------------------- */

  /** Fire and forget. Returns false if the socket is backed up. */
  private send(deviceId: number, packetId: number, data?: Buffer): boolean {
    if (!this.socket || this.socket.destroyed) return false;
    return this.socket.write(encodePacket(deviceId, packetId, data));
  }

  private request(deviceId: number, packetId: number, data: Buffer | undefined, timeoutMs = 4000) {
    return new Promise<Buffer>((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) { reject(new Error('not connected')); return; }
      const timer = setTimeout(() => {
        this.pending = this.pending.filter((p) => p.timer !== timer);
        reject(new Error(`timeout waiting for packet ${packetId}`));
      }, timeoutMs);
      this.pending.push({ packetId, deviceId, resolve, reject, timer });
      this.send(deviceId, packetId, data);
    });
  }

  /* ---------------------------------------------------------------- */
  /* device discovery                                                 */
  /* ---------------------------------------------------------------- */

  async refreshControllers(): Promise<Controller[]> {
    const countReply = await this.request(0, Packet.REQUEST_CONTROLLER_COUNT, undefined);
    const count = countReply.readUInt32LE(0);

    const out: Controller[] = [];
    for (let i = 0; i < count; i++) {
      const body = this.protocol >= 1 ? buildProtocolVersion(this.protocol) : undefined;
      const blob = await this.request(i, Packet.REQUEST_CONTROLLER_DATA, body);
      out.push(decodeController(blob, i, this.protocol));
    }

    this.controllers = out;
    this.emit('controllers', out);
    return out;
  }

  /**
   * Put a controller into the mode that accepts per-LED writes. Without this,
   * UPDATELEDS is silently ignored on most hardware and you spend an evening
   * wondering why nothing lights up.
   */
  async enableDirectMode(index: number): Promise<boolean> {
    const c = this.controllers[index];
    if (!c) return false;

    const direct = findDirectMode(c);
    if (direct >= 0) {
      this.send(index, Packet.RGBCONTROLLER_UPDATEMODE,
        buildUpdateMode(direct, c.modes[direct], this.protocol));
      c.activeMode = direct;
      return true;
    }

    // No per-LED mode advertised. SETCUSTOMMODE is the older fallback and some
    // controllers honour it anyway.
    this.send(index, Packet.RGBCONTROLLER_SETCUSTOMMODE);
    return false;
  }

  async enableDirectModeAll() {
    const unsupported: string[] = [];
    for (let i = 0; i < this.controllers.length; i++) {
      const ok = await this.enableDirectMode(i);
      if (!ok) unsupported.push(this.controllers[i].name);
    }
    return unsupported;
  }

  /* ---------------------------------------------------------------- */
  /* writing frames                                                   */
  /* ---------------------------------------------------------------- */

  /** `rgb` is a flat Uint8Array of RGB triples covering every LED on the device. */
  updateLeds(index: number, rgb: Uint8Array): boolean {
    return this.send(index, Packet.RGBCONTROLLER_UPDATELEDS, buildUpdateLeds(rgb));
  }

  updateZoneLeds(index: number, zone: number, rgb: Uint8Array): boolean {
    return this.send(index, Packet.RGBCONTROLLER_UPDATEZONELEDS, buildUpdateZoneLeds(zone, rgb));
  }

  /**
   * Tell OpenRGB how many LEDs are really on a resizable zone.
   *
   * The server answers with DEVICE_LIST_UPDATED rather than a direct reply, so
   * re-read the controllers afterwards: LED counts, offsets and the flat LED
   * array all shift. Sizes are clamped to the zone's advertised range so a bad
   * number cannot be sent to hardware.
   */
  async resizeZone(index: number, zone: number, ledCount: number): Promise<Controller[]> {
    const ctrl = this.controllers[index];
    const z = ctrl?.zones?.[zone];
    if (!ctrl || !z) throw new Error(`no such zone ${index}:${zone}`);
    if (z.ledsMax <= z.ledsMin) throw new Error(`zone "${z.name}" is not resizable`);

    const size = Math.max(z.ledsMin, Math.min(z.ledsMax, Math.round(ledCount)));
    this.send(index, Packet.RGBCONTROLLER_RESIZEZONE, buildResizeZone(zone, size));

    // No ack for this packet. Give the server a beat to rebuild the controller
    // before asking for it again, or we read back the pre-resize layout.
    await new Promise((r) => setTimeout(r, 120));
    return this.refreshControllers();
  }

  /** True while the kernel send buffer is drained enough to accept a new frame. */
  get writable() {
    return !!this.socket && !this.socket.destroyed && this.socket.writableLength < 64 * 1024;
  }
}
