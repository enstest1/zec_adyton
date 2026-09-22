/**
 * Mint + reveal page logic. No secrets leave the browser.
 */
import {
  buildCommitment, challengeFor, buildRecord, buildRevealChunks,
  scoreOf, randomBytes32, bytesToHex, hexToBytes,
  MAX_WORK_BITS, MAX_PATIENCE, MAX_MONEY, CHALLENGE_WINDOW,
} from "./protocol.js";
import { checkVectors } from "./check-vectors.js";
import { TREASURY } from "./config.js";
import { resolveTableStateUrls } from "./pub-urls.js";
import {
  assertBurnerFunded,
  formatZec,
  fundingAmount,
  fundingFromBid,
} from "./tx/funding.js";
import { buildKeyfile, KEYFILE_FUNDS_WARNING } from "./tx/keyfile.js";

/** Burner UTXO balance in zatoshis once the signer is live; null until then. */
let burnerBalanceZat = null;

const SEAT_BOUNDS = [[8, 4], [24, 3], [56, 2], [88, 1]];
const TIER_NAMES = ["drone", "runner", "warden", "cipher", "oracle"];
const FLOOR_PERMILLE = [0, 200, 420, 640, 840];
const EPOCH_SIZE = 128;

const $ = (id) => document.getElementById(id);

// Same-origin only; cross-origin ?table= / ?state= throws (see pub-urls.js).
let TABLE_URL;
let STATE_URL;
try {
  ({ table: TABLE_URL, state: STATE_URL } = resolveTableStateUrls(
    new URLSearchParams(location.search),
    location.href,
  ));
} catch (e) {
  // Surface immediately — do not fall back to attacker-controlled or default
  // paths after a refused override (would hide the attack).
  TABLE_URL = null;
  STATE_URL = null;
  window.__pubUrlError = e;
}

function maxLiveScore() { return scoreOf(MAX_WORK_BITS, MAX_PATIENCE, 0, MAX_MONEY); }
function scoreFloors() {
  const m = maxLiveScore();
  return FLOOR_PERMILLE.map((p) => Math.floor((m * p) / 1000));
}
function tierByScore(score) {
  const floors = scoreFloors();
  for (let i = 1; i < floors.length; i++) if (score < floors[i]) return i - 1;
  return 4;
}
function tierForRank(rank, n) {
  const pos = Math.floor((rank * EPOCH_SIZE) / n);
  for (const [bound, tier] of SEAT_BOUNDS) if (pos < bound) return tier;
  return 0;
}
function assignTier(rank, n, score) {
  return Math.min(tierForRank(rank, n), tierByScore(score) + 1);
}

function tagFromHex(hex) {
  const h = hex.trim().replace(/^0x/, "");
  if (h.length !== 40) throw new Error("minerTag must be 20 bytes (40 hex chars)");
  return hexToBytes(h);
}

let table = null;
let state = null;
let keyfile = null; // held until user downloads
let minedRecord = null;

async function refreshTable() {
  if (!TABLE_URL || !STATE_URL) {
    throw new Error(String(window.__pubUrlError?.message || "pub URLs not configured"));
  }
  const [tRes, sRes] = await Promise.all([fetch(TABLE_URL), fetch(STATE_URL)]);
  if (!tRes.ok) throw new Error(`table.json ${tRes.status} — is the publisher running?`);
  if (!sRes.ok) throw new Error(`state.json ${sRes.status}`);
  table = await tRes.json();
  state = await sRes.json();
  renderTable();
  project();
}

function renderTable() {
  const ep = table.epoch || {};
  $("tip").textContent = String(table.tip_height ?? "—");
  $("minted").textContent = `${table.minted}/${table.supply_cap}`;
  $("floor").textContent = `${(table.floor_price_zat / 1e8).toFixed(4)} ZEC (${table.floor_price_zat} zat)`;
  $("digest").textContent = state.digest ? state.digest.slice(0, 16) + "…" : "—";
  if (ep.open) {
    $("epoch").textContent = `#${ep.number}  ${ep.filled}/${ep.seats} seats`;
    $("seal").textContent = `timeout @ ${ep.timeout_height}  (${ep.timeout_height - table.tip_height} blocks)`;
  } else {
    $("epoch").textContent = `#${ep.number} (next mint opens)`;
    $("seal").textContent = "—";
  }
  $("baseBits").textContent = String(table.base_bits);
}

function project() {
  const work = +$("work").value;
  const patience = +$("patience").value;
  const money = +$("money").value;
  const score = scoreOf(work, patience, 0, money);
  $("score").textContent = score.toLocaleString();

  const floor = table?.floor_price_zat ?? 0;
  const pay = floor * (1 + money);
  $("pay").textContent = `${(pay / 1e8).toFixed(4)} ZEC  (${pay} zat)`;
  // C1: ONE number from live floor × (1 + money) — never a hardcoded total.
  const fund = floor > 0 ? fundingFromBid(floor, money) : fundingAmount({ payZat: 0 });
  $("fundingNeed").textContent =
    `${formatZec(fund.totalZat)} ZEC (${fund.totalZat} zat) ` +
    `= pay ${fund.payZat} + mintFee ${fund.mintFeeZat} + revealFee ${fund.revealFeeZat} + buffer ${fund.bufferZat}`;
  // TREASURY is a build-time constant — never from fetched JSON.
  $("treasuryBid").textContent = TREASURY;

  const ep = table?.epoch;
  const field = (ep && ep.open && ep.bids) ? ep.bids.map((b) => b.score) : [];
  // Rank if we joined now: how many current bids beat us
  const better = field.filter((s) => s > score).length;
  const tied = field.filter((s) => s === score).length;
  const nIfJoin = field.length + 1;
  const rank = better; // optimistic: ties break on seal lottery
  const tierNow = assignTier(rank, Math.max(nIfJoin, 1), score);
  const tierFull = assignTier(rank, EPOCH_SIZE, score);
  $("proj").textContent =
    `score ${score.toLocaleString()} → if sealed now: ${TIER_NAMES[tierNow]} (rank ~${rank}/${nIfJoin})` +
    ` · if epoch fills: ${TIER_NAMES[tierFull]}` +
    (tied ? ` · ${tied} live bid(s) tie your score (seal lottery)` : "") +
    ` · later higher bids can still push you down`;
}

async function mine() {
  if (!table?.tip_hash) throw new Error("no tip_hash in table — publisher not ready");
  const work = +$("work").value;
  const patience = +$("patience").value;
  const money = +$("money").value;
  const tag = tagFromHex($("tag").value);
  // Refuse to mine if we already know the burner cannot cover mint+reveal.
  const fundPreview = fundingFromBid(table.floor_price_zat ?? 0, money);
  if (burnerBalanceZat != null) {
    assertBurnerFunded(burnerBalanceZat, fundPreview);
  }

  const secret = randomBytes32();
  const seed = randomBytes32();
  const salt = randomBytes32();
  const commitment = buildCommitment(secret, seed, salt, work, patience, 0, money);
  const challenge = challengeFor(hexToBytes(table.tip_hash));
  const bits = table.base_bits + work;
  const lastOk = table.tip_height + CHALLENGE_WINDOW;

  $("mineStatus").textContent = `mining ${bits} bits against tip ${table.tip_height}…`;
  $("hashRate").textContent = "0";
  $("recordBox").classList.add("hidden");
  $("keyfileGate").classList.remove("hidden");
  minedRecord = null;

  const cores = Math.max(1, navigator.hardwareConcurrency || 2);
  const workers = [];
  let totalHashes = 0;
  const t0 = performance.now();
  let found = null;

  await new Promise((resolve, reject) => {
    let settled = false;
    for (let i = 0; i < cores; i++) {
      const w = new Worker(new URL("./miner-worker.js", import.meta.url), { type: "module" });
      workers.push(w);
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === "progress") {
          totalHashes += m.hashes;
          const el = (performance.now() - t0) / 1000;
          $("hashRate").textContent =
            `${(totalHashes / 1e6).toFixed(2)}M  ${(totalHashes / Math.max(el, 0.001) / 1000).toFixed(0)} kH/s`;
        }
        if (m.type === "found" && !settled) {
          settled = true;
          found = m;
          workers.forEach((x) => x.postMessage({ cmd: "stop" }));
          resolve();
        }
      };
      w.onerror = (e) => { if (!settled) { settled = true; reject(e); } };
      w.postMessage({
        cmd: "mine",
        challenge: bytesToHex(challenge),
        commitment: bytesToHex(commitment),
        tag: bytesToHex(tag),
        bits,
        start: i,
        stride: cores,
      });
    }
  });
  workers.forEach((w) => w.terminate());

  const nonce = BigInt(found.nonce);
  const record = buildRecord(commitment, nonce, work, patience, 0, money, tag);
  const floor = table.floor_price_zat;
  const pay = floor * (1 + money);

  keyfile = buildKeyfile({
    commitment: bytesToHex(commitment),
    secret: bytesToHex(secret),
    seed: bytesToHex(seed),
    salt: bytesToHex(salt),
    work, patience, burn: 0, money,
    nonce: nonce.toString(),
    tag: bytesToHex(tag),
    challenge_height: table.tip_height,
    tip_hash: table.tip_hash,
    floor_zat: floor,
    pay_zat: pay,
    valid_through_height: lastOk,
    mined_at: Math.floor(Date.now() / 1000),
  });
  const funding = fundingFromBid(floor, money);
  minedRecord = {
    recordHex: bytesToHex(record),
    payZat: pay,
    funding,
    lastOk,
    bits,
  };
  keyfile.funding_zat = funding.totalZat;
  keyfile.mint_fee_zat = funding.mintFeeZat;
  keyfile.reveal_fee_zat = funding.revealFeeZat;
  const retAddr = $("revealReturnAddr")?.value?.trim();
  if (retAddr) keyfile.reveal_return_address = retAddr;

  $("mineStatus").textContent = "SOLUTION FOUND";
  $("keyfileWarn").classList.remove("hidden");
  $("btnSaveKey").disabled = false;
  $("recordPending").textContent =
    KEYFILE_FUNDS_WARNING +
    " OP_RETURN hex is withheld until you download the keyfile.";
}

function downloadKeyfile() {
  if (!keyfile) return;
  const blob = new Blob([JSON.stringify([keyfile], null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `zvault-keys-${keyfile.commitment.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);

  // Only now reveal the record
  $("recordBox").classList.remove("hidden");
  $("opreturn").textContent = minedRecord.recordHex;
  const fund = minedRecord.funding;
  $("payExact").textContent = `${formatZec(minedRecord.payZat)} ZEC (${minedRecord.payZat} zat)`;
  $("fundingExact").textContent =
    `${formatZec(fund.totalZat)} ZEC (${fund.totalZat} zat) — send this ONE amount to the burner`;
  const gate = $("fundingGate");
  if (burnerBalanceZat != null) {
    try {
      assertBurnerFunded(burnerBalanceZat, fund);
      gate.classList.add("hidden");
      gate.textContent = "";
    } catch (e) {
      gate.textContent = String(e.message || e);
      gate.classList.remove("hidden");
    }
  } else {
    gate.classList.add("hidden");
  }
  $("treasuryPay").textContent = TREASURY;
  $("deadline").textContent = String(minedRecord.lastOk);
  $("cliCmd").textContent =
    `# Broadcast BEFORE block ${minedRecord.lastOk}\n` +
    `# Fund burner with ${fund.totalZat} zat (${formatZec(fund.totalZat)} ZEC) — ONE number:\n` +
    `#   pay ${fund.payZat} + mintFee ${fund.mintFeeZat} + revealFee ${fund.revealFeeZat} + buffer ${fund.bufferZat}\n` +
    `# Treasury payment inside the mint tx: ${minedRecord.payZat} zat to:\n` +
    `#   ${TREASURY}\n` +
    `# Compare this address to the repo / launch thread before sending.\n` +
    `# Attach OP_RETURN payload (hex):\n${minedRecord.recordHex}\n\n` +
    `# Example shape (zallet / zcash-cli):\n` +
    `zcash-cli createrawtransaction '[]' ` +
    `'{"data":"${minedRecord.recordHex}","${TREASURY}":${formatZec(minedRecord.payZat)}}'\n` +
    `# then fundrawtransaction + sign + sendrawtransaction\n` +
    `# amount = ${minedRecord.payZat} zat = ${formatZec(minedRecord.payZat)} ZEC`;
  $("recordPending").textContent =
    "Keyfile saved offline. It protects FUNDS and openability. Then fund (one send) and broadcast.";
  // Signed hex filled by the signer once built; until then show placeholder.
  if ($("signedHex") && $("signedHex").textContent === "—") {
    $("signedHex").textContent =
      "(signer will place already-signed mint hex here — copy and broadcast yourself, or use the postbox relay)";
  }
}

/** Called by the burner/signer once UTXO balance is known (T5+). */
export function setBurnerBalanceZat(zat) {
  burnerBalanceZat = zat;
  if (table) project();
}

function copyText(id) {
  const t = $(id).textContent;
  navigator.clipboard.writeText(t);
}

// ----- reveal flow ----------------------------------------------------------

function loadKeyfile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        const entry = Array.isArray(data) ? data[0] : data;
        resolve(entry);
      } catch (e) { reject(e); }
    };
    r.onerror = reject;
    r.readAsText(file);
  });
}

async function prepareReveal(entry) {
  await refreshTable();
  const tip = table.tip_height;
  // We need seal + patience from chain state — state.json does not list per-mint
  // unlock. For v1 we emit chunks and let the indexer reject if early; surface
  // what we know from the keyfile.
  const mintHeight = entry.challenge_height; // approximate; real unlock uses mint height
  const unlock = mintHeight + entry.patience * 1152;
  $("revealStatus").textContent =
    `tip ${tip} · keyfile patience unlock ≥ ${unlock} (approx from challenge height) · ` +
    `indexer enforces seal + exact mint height`;

  const [a, b] = buildRevealChunks(
    entry.index ?? 0,
    hexToBytes(entry.secret),
    hexToBytes(entry.seed),
    hexToBytes(entry.salt),
  );
  // If index unknown, user must set it
  const index = +$("revealIndex").value;
  const [a2, b2] = buildRevealChunks(
    index,
    hexToBytes(entry.secret),
    hexToBytes(entry.seed),
    hexToBytes(entry.salt),
  );
  $("revealA").textContent = bytesToHex(a2);
  $("revealB").textContent = bytesToHex(b2);
  $("revealCli").textContent =
    `# Two OP_RETURN outputs in ONE transaction; transparent in/out must match minerTag ${entry.tag}\n` +
    `# Chunk A (74 bytes):\n${bytesToHex(a2)}\n` +
    `# Chunk B (42 bytes):\n${bytesToHex(b2)}\n` +
    `# Broadcast only after epoch sealed and patience served.`;
  $("revealOut").classList.remove("hidden");
}

/** Poll pub/ for the rendered punk after the reveal tx confirms. */
async function watchMyPunk(index) {
  $("revealStatus").textContent = `watching for punk #${index}…`;
  for (let i = 0; i < 120; i++) {
    try {
      await refreshTable();
      const r = await fetch(`./pub/punks/${index}.json`);
      if (r.ok) {
        const t = await r.json();
        $("myPunk").classList.remove("hidden");
        $("punkImg").src = `./pub/punks/${index}.png?t=${Date.now()}`;
        $("punkTier").textContent = t.tier_name || t.tier || "—";
        $("punkIndex").textContent = String(index);
        $("punkTraits").textContent = [
          "chassis", "palette", "visor", "hood", "vent", "mark", "aura",
        ].map((k) => `${k}:${t[k]}`).join(" · ");
        $("punkVerify").textContent = t.verify || "";
        $("revealStatus").textContent = `punk #${index} landed`;
        return;
      }
    } catch (_) { /* keep polling */ }
    await new Promise((res) => setTimeout(res, 2500));
  }
  $("revealStatus").textContent =
    `punk #${index} not in pub/ yet — is the publisher running?`;
}

async function boot() {
  $("trust").textContent =
    "This page is static. After load it only fetches same-origin table.json / state.json. " +
    "Secrets, seeds and salts are created with crypto.getRandomValues and never uploaded. " +
    "Treasury address is hardcoded in the page source — never taken from those JSON files.";
  $("treasuryBid").textContent = TREASURY;

  if (window.__pubUrlError) {
    const msg = String(window.__pubUrlError.message || window.__pubUrlError);
    $("tableErr").textContent = msg;
    $("btnMine").disabled = true;
    $("btnRefresh").disabled = true;
    console.error(window.__pubUrlError);
    return;
  }

  try {
    const r = await checkVectors("./vectors.json");
    $("vectors").textContent = `vectors OK (${r.checked} checks)`;
    $("vectors").classList.add("ok");
  } catch (e) {
    $("vectors").textContent = `VECTOR MISMATCH — mining disabled: ${e.message}`;
    $("vectors").classList.add("fail");
    $("btnMine").disabled = true;
    console.error(e);
    return;
  }

  try {
    await refreshTable();
  } catch (e) {
    $("tableErr").textContent = String(e.message || e);
  }

  $("work").max = MAX_WORK_BITS;
  $("patience").max = MAX_PATIENCE;
  $("money").max = MAX_MONEY;
  ["work", "patience", "money"].forEach((id) => $(id).addEventListener("input", project));

  $("btnRefresh").onclick = () => refreshTable().catch((e) => alert(e));
  $("btnMine").onclick = () => mine().catch((e) => { $("mineStatus").textContent = String(e); console.error(e); });
  $("btnSaveKey").onclick = downloadKeyfile;
  $("btnCopyOp").onclick = () => copyText("opreturn");
  $("btnCopyCli").onclick = () => copyText("cliCmd");
  if ($("btnCopySigned")) $("btnCopySigned").onclick = () => copyText("signedHex");

  $("keyfileInput").onchange = async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const entry = await loadKeyfile(f);
      window.__revealKey = entry;
      $("revealMeta").textContent = `commitment ${entry.commitment?.slice(0, 16)}… tag ${entry.tag}`;
    } catch (e) { alert(e); }
  };
  $("btnReveal").onclick = () => {
    if (!window.__revealKey) return alert("load a keyfile first");
    prepareReveal(window.__revealKey).catch((e) => alert(e));
  };
  $("btnCopyRev").onclick = () => copyText("revealCli");
  $("btnWatchPunk").onclick = () => {
    const index = +$("revealIndex").value;
    watchMyPunk(index).catch((e) => alert(e));
  };
}

boot();
