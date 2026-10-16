import crypto from 'crypto';

let counter = crypto.randomInt(0xffffff);
const processRandom = crypto.randomBytes(5).toString('hex');

// 24 hex characters, laid out like a MongoDB ObjectId (seconds timestamp, per-process random,
// counter), so ids keep the format the client has always received and sort by creation time.
export function newId(): string {
  counter = (counter + 1) % 0x1000000;
  const seconds = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  return seconds + processRandom + counter.toString(16).padStart(6, '0');
}
