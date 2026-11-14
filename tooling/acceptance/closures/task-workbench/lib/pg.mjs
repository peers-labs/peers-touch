// Minimal PostgreSQL wire client (SCRAM-SHA-256, simple query protocol) for
// task-workbench closures. The acceptance cell has no psql binary and no npm
// registry; this is dependency-free node:net so a closure can read Station
// truth directly from Postgres (the same assertion class as tw-o09's direct
// SQL checks). Read-only by construction: only Simple Query is implemented
// and callers issue SELECTs.
import crypto from 'node:crypto';
import net from 'node:net';

const AUTH_OK = 0;
const AUTH_SASL = 10;
const AUTH_SASL_CONTINUE = 11;
const AUTH_SASL_FINAL = 12;

function frame(type, payload) {
  const header = Buffer.alloc(5);
  header.writeUInt8(type.charCodeAt(0), 0);
  header.writeUInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

function startupMessage(options) {
  const pairs = Object.entries(options)
    .flatMap(([key, value]) => [Buffer.from(`${key}\0${value}\0`, 'utf8')]);
  pairs.push(Buffer.from('\0', 'utf8'));
  const protocol = Buffer.alloc(4);
  protocol.writeUInt32BE(0x00030000, 0);
  const body = Buffer.concat([protocol, ...pairs]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length + 4, 0);
  return Buffer.concat([header, body]);
}

function xor(left, right) {
  const out = Buffer.alloc(left.length);
  for (let i = 0; i < left.length; i += 1) out[i] = left[i] ^ right[i];
  return out;
}

function parseSaslAttributes(value) {
  const attrs = {};
  for (const part of value.split(',')) {
    attrs[part[0]] = part.slice(2);
  }
  return attrs;
}

function scramClientFinal({ password, clientFirstBare, serverFirst }) {
  const attrs = parseSaslAttributes(serverFirst);
  const salt = Buffer.from(attrs.s, 'base64');
  const iterations = Number(attrs.i);
  const saltedPassword = crypto.pbkdf2Sync(
    password,
    salt,
    iterations,
    32,
    'sha256',
  );
  const clientKey = crypto.createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = crypto.createHash('sha256').update(clientKey).digest();
  const channelBinding = Buffer.from('n,,', 'utf8').toString('base64');
  const clientFinalWithoutProof = `c=${channelBinding},r=${attrs.r}`;
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
  const clientSignature = crypto
    .createHmac('sha256', storedKey)
    .update(authMessage)
    .digest();
  const proof = xor(clientKey, clientSignature).toString('base64');
  const clientFinal = `${clientFinalWithoutProof},p=${proof}`;

  const serverKey = crypto.createHmac('sha256', saltedPassword).update('Server Key').digest();
  const expectedServerSignature = crypto
    .createHmac('sha256', serverKey)
    .update(authMessage)
    .digest('base64');
  return { clientFinal, expectedServerSignature, nonce: attrs.r };
}

function saslInitialResponse(mechanism, clientFirst) {
  const mechanismBytes = Buffer.from(`${mechanism}\0`, 'utf8');
  const responseBytes = Buffer.from(clientFirst, 'utf8');
  const length = Buffer.alloc(4);
  length.writeInt32BE(responseBytes.length, 0);
  return Buffer.concat([mechanismBytes, length, responseBytes]);
}

// Parses one message: type byte + uint32 payload length + payload.
function readMessage(buffer, offset) {
  const length = buffer.readUInt32BE(offset + 1);
  const payload = buffer.subarray(offset + 5, offset + 1 + length);
  return { type: String.fromCharCode(buffer[offset]), payload, next: offset + 1 + length };
}

async function authenticate(socket, { user, password, database }) {
  const nonce = crypto.randomBytes(18).toString('base64').replace(/[+/=]/g, '');
  const clientFirstBare = `n=${user},r=${nonce}`;
  await new Promise((resolve, reject) => {
    socket.write(startupMessage({ user, database, application_name: 'tw-closure' }));
    let acc = Buffer.alloc(0);
    let step = 'initial';
    let pending = null;

    const send = (payload) => new Promise((done) => socket.write(payload, done));

    const onAuthData = async (chunk) => {
      acc = Buffer.concat([acc, chunk]);
      try {
        let offset = 0;
        while (offset + 5 <= acc.length) {
          const total = acc.readUInt32BE(offset + 1) + 1;
          if (acc.length < offset + total) break;
          const { type, payload, next } = readMessage(acc, offset);
          offset = next;
          if (type === 'R') {
            const authType = payload.readUInt32BE(0);
            if (step === 'initial' && authType === AUTH_SASL) {
              const clientFirst = `n,,${clientFirstBare}`;
              await send(frame('p', saslInitialResponse('SCRAM-SHA-256', clientFirst)));
              step = 'continue';
            } else if (step === 'continue' && authType === AUTH_SASL_CONTINUE) {
              const serverFirst = payload.subarray(4).toString('utf8');
              const { clientFinal, expectedServerSignature } = scramClientFinal({
                password,
                clientFirstBare,
                serverFirst,
              });
              pending = expectedServerSignature;
              await send(frame('p', Buffer.from(clientFinal, 'utf8')));
              step = 'final';
            } else if (step === 'final' && authType === AUTH_SASL_FINAL) {
              const serverFinal = payload.subarray(4).toString('utf8');
              const attrs = parseSaslAttributes(serverFinal);
              if (attrs.v !== pending) {
                reject(new Error('SCRAM server signature mismatch'));
                return;
              }
            } else if (authType !== AUTH_OK) {
              reject(new Error(`unsupported auth type ${authType}`));
              return;
            }
          } else if (type === 'E') {
            reject(new Error(`postgres: ${payload.toString('utf8').replace(/\0/g, ' ')}`));
            return;
          } else if (type === 'Z') {
            socket.off('data', onAuthData);
            resolve();
            return;
          }
        }
        if (offset > 0) acc = acc.subarray(offset);
      } catch (error) {
        reject(error);
      }
    };
    socket.on('data', onAuthData);
    socket.on('error', reject);
  });
}

// Runs one SELECT and returns rows keyed by column name. Values are simple
// protocol strings (callers parse numbers themselves).
export async function pgQuery(sql, options = {}) {
  const config = {
    host: process.env.PT_TW_PGHOST ?? '172.26.0.2',
    port: Number(process.env.PT_TW_PGPORT ?? '5432'),
    user: process.env.PT_TW_PGUSER ?? 'peers',
    database: process.env.PT_TW_PGDATABASE ?? 'peers_touch_tw_d1',
    password: options.password ?? process.env.PT_TW_PGPASSWORD ?? '',
  };
  const socket = net.createConnection({ host: config.host, port: config.port });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  try {
    await authenticate(socket, {
      user: config.user,
      password: config.password,
      database: config.database,
    });
    return await new Promise((resolve, reject) => {
      socket.write(frame('Q', Buffer.from(`${sql}\0`, 'utf8')));
      let acc = Buffer.alloc(0);
      let columns = [];
      const rows = [];
      const onData = (chunk) => {
        acc = Buffer.concat([acc, chunk]);
        try {
          let offset = 0;
          while (offset + 5 <= acc.length) {
            const total = acc.readUInt32BE(offset + 1) + 1;
            if (acc.length < offset + total) break;
            const { type, payload, next } = readMessage(acc, offset);
            offset = next;
            if (type === 'T') {
              const count = payload.readInt16BE(0);
              columns = [];
              let cursor = 2;
              for (let i = 0; i < count; i += 1) {
                const end = payload.indexOf(0, cursor);
                columns.push(payload.subarray(cursor, end).toString('utf8'));
                // Skip name + tableOID(4)+attrIndex(2)+typeOID(4)+size(2)+modifier(4)+format(2).
                cursor = end + 1 + 18;
              }
            } else if (type === 'D') {
              const count = payload.readInt16BE(0);
              let cursor = 2;
              const row = {};
              for (let i = 0; i < count; i += 1) {
                const length = payload.readInt32BE(cursor);
                cursor += 4;
                if (length === -1) {
                  row[columns[i]] = null;
                } else {
                  row[columns[i]] = payload.subarray(cursor, cursor + length).toString('utf8');
                  cursor += length;
                }
              }
              rows.push(row);
            } else if (type === 'E') {
              reject(new Error(`postgres query: ${payload.toString('utf8').replace(/\0/g, ' ')}`));
              return;
            } else if (type === 'Z') {
              socket.off('data', onData);
              resolve({ columns, rows });
              return;
            }
          }
          if (offset > 0) acc = acc.subarray(offset);
        } catch (error) {
          reject(error);
        }
      };
      socket.on('data', onData);
      socket.on('error', reject);
    });
  } finally {
    socket.destroy();
  }
}
