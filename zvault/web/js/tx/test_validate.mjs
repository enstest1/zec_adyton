/**
 * T7 validate + T6 relay client tests (mocked RPC / fetch).
 * Run: node js/tx/test_validate.mjs
 */
import { validateSignedTx, relayBroadcast } from "./validate.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert");
}

async function throwsAsync(fn, needle) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert(err, "expected throw");
  assert(String(err.message).includes(needle), err.message);
}

await throwsAsync(() => validateSignedTx("aabb", null), "rpcCall");
await throwsAsync(
  () => validateSignedTx("zz", async () => ({})),
  "invalid"
);

const decoded = { txid: "deadbeef", version: 5 };
let sent = null;
const r = await validateSignedTx("aabb", async (method, params) => {
  if (method === "decoderawtransaction") return decoded;
  if (method === "sendrawtransaction") {
    sent = params[0];
    return "txiddeadbeef00112233445566778899aabbccddeeff001122334455";
  }
  throw new Error(`unexpected ${method}`);
});
assert(r.accepted && r.txid.startsWith("txid"), "broadcast ok");
assert(sent === "aabb", "hex forwarded");

const dry = await validateSignedTx("ccdd", async (m) => {
  if (m === "decoderawtransaction") return decoded;
  throw new Error("should not send");
}, { broadcast: false });
assert(dry.accepted === false && !dry.txid, "decode-only");

// Relay client shape
globalThis.fetch = async (url, init) => {
  assert(url.endsWith("/broadcast"), url);
  const body = JSON.parse(init.body);
  assert(body.hex === "ff00", "hex only");
  return {
    ok: true,
    json: async () => ({ txid: "relayedtxid" }),
  };
};
const tid = await relayBroadcast("http://127.0.0.1:8091", "ff00");
assert(tid === "relayedtxid");

console.log("T6/T7 validate+relay client OK");
