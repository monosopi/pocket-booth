/**
 * printer.js — Paperang P1 over Web Bluetooth (Chrome/Edge on desktop or Android, HTTPS only).
 *
 * Packet format: [0x02][cmd][index][len lo][len hi][payload...][CRC32 x4, little-endian][0x03]
 * The CRC32 uses Paperang's custom seed 0x35769521 and covers the payload only.
 * The P1 prints 384 px per row = 48 bytes per row, 1 bit per pixel (1 = black).
 */

const PRINT_WIDTH_PX = 384;
const BYTES_PER_ROW = PRINT_WIDTH_PX / 8; // 48
const ROWS_PER_PACKET = 20;               // 20 * 48 = 960 bytes (limit is ~1023)
const CRC_SEED = 0x35769521;
const CMD_PRINT_BITMAP = 0x00;
const CMD_FEED_PAPER = 0x1a;
const FEED_LINES_AFTER = 80;              // blank rows pushed out so you can tear the strip
const LSB_FIRST = false;                  // flip to true if the image prints mirrored in 8px blocks
const BLE_CHUNK_BYTES = 100;              // Bluetooth LE writes must be small
const CHUNK_DELAY_MS = 12;                // pause between writes so the printer keeps up
const ACCEPT_ALL_DEVICES = false;         // true = show every nearby BLE device in the picker
const NAME_PREFIXES = ['Paperang', 'MiaoMiao'];
const PRINTER_SERVICE_UUID = null;        // set to the exact service UUID once you know it
const CANDIDATE_SERVICES = [
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

let device = null;
let writeChar = null;
let deviceName = null;
let printing = false;
let status = isSupported() ? 'idle' : 'unsupported';
const listeners = new Set();

export function isSupported() {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export function isConnected() {
  return Boolean(device && device.gatt && device.gatt.connected && writeChar);
}

/** cb({ status, deviceName }) runs now and on every change. Returns an unsubscribe fn. */
export function onStatusChange(cb) {
  listeners.add(cb);
  cb({ status, deviceName });
  return () => listeners.delete(cb);
}

function setStatus(next) {
  status = next;
  listeners.forEach((cb) => cb({ status, deviceName }));
}

function clearConnectionState() {
  writeChar = null;
  deviceName = null;
}

/** Opens the browser's device picker. Resolves true on success, false if the user cancelled. */
export async function connect() {
  if (!isSupported()) {
    setStatus('unsupported');
    throw new Error('Web Bluetooth is not supported here. Try Chrome on desktop or Android.');
  }
  if (isConnected()) return true;

  try {
    setStatus('connecting');
    if (!device) {
      const options = { optionalServices: PRINTER_SERVICE_UUID ? [PRINTER_SERVICE_UUID] : CANDIDATE_SERVICES };
      if (ACCEPT_ALL_DEVICES) options.acceptAllDevices = true;
      else options.filters = NAME_PREFIXES.map((namePrefix) => ({ namePrefix }));
      device = await navigator.bluetooth.requestDevice(options);
      device.addEventListener('gattserverdisconnected', onDisconnected);
    }
    deviceName = device.name || 'Paperang';
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    writeChar = await findWriteCharacteristic(server);
    if (!writeChar) throw new Error('No writable Bluetooth characteristic found on this printer.');
    setStatus('connected');
    return true;
  } catch (err) {
    clearConnectionState();
    if (err && err.name === 'NotFoundError') {
      device = null;
      setStatus('idle');
      return false;
    }
    device = null;
    setStatus('error');
    throw err;
  }
}

export function disconnect() {
  if (device && device.gatt && device.gatt.connected) device.gatt.disconnect();
  device = null;
  onDisconnected();
}

function onDisconnected() {
  clearConnectionState();
  setStatus(isSupported() ? 'idle' : 'unsupported');
}

/** Pick the service/characteristic we write print data to. */
async function findWriteCharacteristic(server) {
  if (!server || !server.connected) {
    throw new Error('GATT Server is disconnected before service lookup.');
  }
  const services = PRINTER_SERVICE_UUID
    ? [await server.getPrimaryService(PRINTER_SERVICE_UUID)]
    : await server.getPrimaryServices();

  for (const service of services) {
    if (/^0000180[01]/.test(service.uuid)) continue;
    const chars = await service.getCharacteristics();
    const writable = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write);
    if (writable) {
      for (const c of chars) {
        if (c.properties.notify) {
          try { await c.startNotifications(); } catch (e) { /* optional */ }
        }
      }
      return writable;
    }
  }
  return null;
}

/** Print a canvas (scaled to 384px wide if needed). Reconnects automatically if GATT dropped. */
export async function printCanvas(canvas) {
  if (printing) throw new Error('Already printing.');
  printing = true;
  try {
    if (!isConnected()) {
      const ok = await connect();
      if (!ok || !isConnected()) throw new Error('Printer is not connected.');
    }

    const rows = canvasToRows(canvas);
    const bytesPerPacket = ROWS_PER_PACKET * BYTES_PER_ROW;
    let index = 0;
    for (let i = 0; i < rows.length; i += bytesPerPacket) {
      await sendBytes(buildPacket(CMD_PRINT_BITMAP, index++, rows.slice(i, i + bytesPerPacket)));
    }
    const feed = new Uint8Array([FEED_LINES_AFTER & 0xff, FEED_LINES_AFTER >> 8]);
    await sendBytes(buildPacket(CMD_FEED_PAPER, index++, feed));
  } finally {
    printing = false;
  }
}

/** Canvas -> packed bits. Dark pixel = 1. Result length = height * 48. */
function canvasToRows(canvas) {
  let src = canvas;
  if (canvas.width !== PRINT_WIDTH_PX) {
    src = document.createElement('canvas');
    src.width = PRINT_WIDTH_PX;
    src.height = Math.round(canvas.height * (PRINT_WIDTH_PX / canvas.width));
    src.getContext('2d').drawImage(canvas, 0, 0, src.width, src.height);
  }
  const { width, height } = src;
  const px = src.getContext('2d').getImageData(0, 0, width, height).data;
  const out = new Uint8Array(height * BYTES_PER_ROW);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4] < 128) {
        const bit = LSB_FIRST ? x & 7 : 7 - (x & 7);
        out[y * BYTES_PER_ROW + (x >> 3)] |= 1 << bit;
      }
    }
  }
  return out;
}

function buildPacket(cmd, index, payload) {
  const len = payload.length;
  const packet = new Uint8Array(len + 10);
  const view = new DataView(packet.buffer);
  packet[0] = 0x02;
  packet[1] = cmd;
  packet[2] = index & 0xff;
  view.setUint16(3, len, true);
  packet.set(payload, 5);
  view.setUint32(5 + len, crc32(payload), true);
  packet[len + 9] = 0x03;
  return packet;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let crc = CRC_SEED;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

async function sendBytes(bytes) {
  if (!isConnected()) {
    throw new Error('GATT Server is disconnected while sending print data.');
  }
  const noResponse = writeChar.properties.writeWithoutResponse;
  for (let i = 0; i < bytes.length; i += BLE_CHUNK_BYTES) {
    if (!device?.gatt?.connected || !writeChar) {
      throw new Error('Printer disconnected mid-print.');
    }
    const chunk = bytes.slice(i, i + BLE_CHUNK_BYTES);
    if (noResponse) await writeChar.writeValueWithoutResponse(chunk);
    else await writeChar.writeValue(chunk);
    await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
  }
}
/**[cite: 6]

For a quick visual guide on pairing and printing with a Paperang P1, watch this [Paperang P1 setup video on YouTube](https://www.youtube.com/watch?v=NUYWjHKyb7o).

<ElicitationsGroup message="What happens after you paste that printer.js and test Print?">
  <Elicitation label="Still disconnects" query="I updated printer.js and it still says GATT Server is disconnected. What should I try next?"/>
  <Elicitation label="Prints blank or garbled" query="It prints now, but the paper comes out blank or garbled. How do I fix the print output?"/>
  <Elicitation label="Different error in console" query="I updated printer.js and got a different error message in the console. Let me share what it says."/>
</ElicitationsGroup>*/