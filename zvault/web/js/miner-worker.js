/**
 * Mining worker — blake2b PoW against a challenge (noble, vector-locked).
 * Message in:  { cmd:'mine', challenge, commitment, tag, bits, start, stride }
 * Message out: { type:'progress', hashes } | { type:'found', nonce, hashes }
 */
import { powHash, powBelowTarget, hexToBytes, bytesToHex } from "./protocol.js";

let stop = false;

self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.cmd === "stop") { stop = true; return; }
  if (msg.cmd !== "mine") return;
  stop = false;

  const challenge = hexToBytes(msg.challenge);
  const commitment = hexToBytes(msg.commitment);
  const tag = hexToBytes(msg.tag);
  const bits = msg.bits;
  let nonce = BigInt(msg.start);
  const stride = BigInt(msg.stride);
  let hashes = 0;

  while (!stop) {
    const pow = powHash(challenge, commitment, tag, nonce);
    hashes++;
    if (powBelowTarget(pow, bits)) {
      self.postMessage({
        type: "found",
        nonce: nonce.toString(),
        hashes,
        pow: bytesToHex(pow),
        worker: msg.start,
      });
      return;
    }
    nonce += stride;
    if (hashes % 5000 === 0) {
      self.postMessage({ type: "progress", hashes, worker: msg.start });
      hashes = 0; // report delta
    }
  }
};
