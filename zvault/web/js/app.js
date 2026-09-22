/**
 * Mint + reveal page — burner wired end-to-end (B1–B7).
 * No secrets leave the browser. No bundler; relative imports only.
 */
import {
  buildCommitment, challengeFor, buildRecord, buildRevealChunks,
  scoreOf, randomBytes32, bytesToHex, hexToBytes,
  MAX_WORK_BITS, MAX_PATIENCE, MAX_MONEY, CHALLENGE_WINDOW,
} from "./protocol.js";
import { checkVectors } from "./check-vectors.js";
import {
  TREASURY, PAGE_NETWORK, assertTreasuryForNetwork,
  utxosJsonUrl, DEFAULT_RELAY_URL,
} from "./config.js";
import { resolveTableStateUrls } from "./pub-urls.js";
import {
  assertBurnerFunded,
  formatZec,
  fundingAmount,
  fundingFromBid,
} from "./tx/funding.js";
import {
  buildKeyfile, recoverFromKeyfile,
  KEYFILE_FUNDS_WARNING, KEYFILE_STAGE_FUNDS, KEYFILE_STAGE_MINT,
} from "./tx/keyfile.js";
import { generatePrivKey } from "./tx/keys.js";
import { addressFromPriv } from "./tx/address.js";
import { buildSignMint, buildSignReveal, buildSignAbandonSweep } from "./tx/builder.js";
import { relayBroadcast } from "./tx/validate.js";
import { parseBranchId } from "./tx/consensus.js";
import { parseTxV5 } from "./tx/v5.js";
import { hexToBytes as hxTx } from "./tx/serialize.js";

/** UTXO poll interval — hits publisher files, not Tatum (0 of 5 rpm). */
const UTXO_POLL_MS = 20_000;
const STATUS_POLL_MS = 15_000;

let burnerBalanceZat = null;
let burnerUtxos = [];
let pollTimer = null;
let statusTimer = null;

const SEAT_BOUNDS = [[8, 4], [24, 3], [56, 2], [88, 1]];
const TIER_NAMES = ["drone", "runner", "warden", "cipher", "oracle"];
const FLOOR_PERMILLE = [0, 200, 420, 640, 840];
const EPOCH_SIZE = 128;
const PATIENCE_UNIT = 1152;

const $ = (id) => document.getElementById(id);

let TABLE_URL;
let STATE_URL;
try {
  ({ table: TABLE_URL, state: STATE_URL } = resolveTableStateUrls(
    new URLSearchParams(location.search),
    location.href,
  ));
} catch (e) {
  TABLE_URL = null;
  STATE_URL = null;
  window.__pubUrlError = e;
}

/** Session state restored from keyfile or generated in-page. */
let session = {
  burnerPriv: null,
  burnerAddress: null,
  burnerTagHex: null,
  fundsKeyfileDownloaded: false,
  mintKeyfileDownloaded: false,
  keyfile: null,
  minedRecord: null,
  mintTxid: null,
  revealTxid: null,
};

let table = null;
let state = null;

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

function forceDownload(obj, filename) {
  const blob = new Blob([JSON.stringify([obj], null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function relayBase() {
  const q = new URLSearchParams(location.search).get("relay");
  if (q) return q.replace(/\/$/, "");
  return (DEFAULT_RELAY_URL || "").replace(/\/$/, "");
}

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
  const fund = floor > 0 ? fundingFromBid(floor, money) : fundingAmount({ payZat: 0 });
  // Recompute mint fee from actual UTXO count when known.
  const nIn = Math.max(1, burnerUtxos.length || 1);
  const fundLive = fundingFromBid(floor || 0, money, { nInMint: nIn });
  $("fundingNeed").textContent =
    `${formatZec(fundLive.totalZat)} ZEC (${fundLive.totalZat} zat) ` +
    `= pay ${fundLive.payZat} + mintFee ${fundLive.mintFeeZat} + revealFee ${fundLive.revealFeeZat} + buffer ${fundLive.bufferZat}` +
    (burnerUtxos.length > 1 ? ` · ${burnerUtxos.length} UTXOs (fee rises)` : "");
  $("treasuryBid").textContent = TREASURY;

  const ep = table?.epoch;
  const field = (ep && ep.open && ep.bids) ? ep.bids.map((b) => b.score) : [];
  const better = field.filter((s) => s > score).length;
  const tied = field.filter((s) => s === score).length;
  const nIfJoin = field.length + 1;
  const rank = better;
  const tierNow = assignTier(rank, Math.max(nIfJoin, 1), score);
  const tierFull = assignTier(rank, EPOCH_SIZE, score);
  $("proj").textContent =
    `score ${score.toLocaleString()} → if sealed now: ${TIER_NAMES[tierNow]} (rank ~${rank}/${nIfJoin})` +
    ` · if epoch fills: ${TIER_NAMES[tierFull]}` +
    (tied ? ` · ${tied} live bid(s) tie your score (seal lottery)` : "") +
    ` · later higher bids can still push you down`;
}

// ----- B0 / B3: balance via publisher utxo files (not node address index) -----

async function fetchBurnerUtxos(address) {
  const url = utxosJsonUrl(address);
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) {
    return { balanceZat: 0, utxos: [], height: null };
  }
  if (!res.ok) throw new Error(`utxos ${res.status}`);
  return res.json();
}

function renderBalance(needZat) {
  const have = burnerBalanceZat ?? 0;
  const el = $("burnerBal");
  const st = $("fundStatus");
  if (!session.fundsKeyfileDownloaded) {
    el.textContent = "download funds keyfile first";
    return;
  }
  if (burnerBalanceZat == null) {
    el.textContent = "polling… (publisher index; not Tatum address-RPC)";
    return;
  }
  el.textContent = `${formatZec(have)} ZEC (${have} zat)` +
    (needZat ? ` / need ${needZat} zat` : "");
  if (needZat && have < needZat) {
    const short = needZat - have;
    st.textContent =
      `UNDERFUNDED — short ${short} zat (${formatZec(short)} ZEC). ` +
      `Send the shortfall in one top-up (still prefer a single original send).`;
    st.classList.add("fail");
    $("btnMine").disabled = true;
  } else if (needZat && have >= needZat) {
    st.textContent = "Funded. You can mine.";
    st.classList.remove("fail");
    $("btnMine").disabled = !session.fundsKeyfileDownloaded;
  } else {
    st.textContent = have > 0 ? "Balance seen — set bid to see funding target." : "No UTXOs yet.";
    st.classList.remove("fail");
  }
  $("btnAbandon").classList.toggle("hidden", !(have > 0 && session.burnerPriv));
  $("btnAbandon").disabled = !(have > 0 && session.burnerPriv && $("revealReturnAddr").value.trim());
}

async function pollBalanceOnce() {
  if (!session.burnerAddress || !session.fundsKeyfileDownloaded) return;
  try {
    const data = await fetchBurnerUtxos(session.burnerAddress);
    burnerUtxos = data.utxos || [];
    burnerBalanceZat = data.balanceZat ?? burnerUtxos.reduce((s, u) => s + u.valueZat, 0);
    const money = +$("money").value;
    const floor = table?.floor_price_zat ?? 0;
    const nIn = Math.max(1, burnerUtxos.length || 1);
    const need = floor > 0 ? fundingFromBid(floor, money, { nInMint: nIn }).totalZat : 0;
    renderBalance(need);
    project();
  } catch (e) {
    $("fundStatus").textContent =
      `UTXO poll: ${e.message || e}. Publisher must be indexing live blocks (B0).`;
  }
}

function startBalancePoll() {
  stopBalancePoll();
  pollBalanceOnce();
  pollTimer = setInterval(pollBalanceOnce, UTXO_POLL_MS);
}

function stopBalancePoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ----- B1 / B2: burner generation + stage-1 keyfile gate -----

function generateBurnerFlow() {
  const ret = $("revealReturnAddr").value.trim();
  if (!ret) {
    alert("Set a return address first — needed for reveal change and abandon-sweep.");
    return;
  }
  const priv = generatePrivKey();
  const net = PAGE_NETWORK === "main" ? "main" : "test";
  const addr = addressFromPriv(priv, net);
  session.burnerPriv = priv;
  session.burnerAddress = addr.address;
  session.burnerTagHex = addr.tagHex;
  session.fundsKeyfileDownloaded = false;
  session.mintKeyfileDownloaded = false;

  const floor = table?.floor_price_zat ?? 0;
  const money = +$("money").value;
  const funding = floor > 0 ? fundingFromBid(floor, money) : fundingAmount({ payZat: 0 });

  const fundsFile = buildKeyfile({
    stage: KEYFILE_STAGE_FUNDS,
    network: PAGE_NETWORK,
    burner: {
      priv_hex: bytesToHex(priv),
      address: addr.address,
      tag: addr.tagHex,
    },
    tag: addr.tagHex,
    reveal_return_address: ret,
    funding_zat: funding.totalZat,
    created_at: Math.floor(Date.now() / 1000),
  });
  // Gate: download BEFORE revealing the funding address (same pattern as OP_RETURN).
  forceDownload(fundsFile, `zvault-funds-${addr.address.slice(0, 10)}.json`);
  session.fundsKeyfileDownloaded = true;
  session.keyfile = fundsFile;

  $("burnerBox").classList.remove("hidden");
  $("burnerAddr").textContent = addr.address;
  $("burnerTag").textContent = addr.tagHex;
  $("btnPollBal").disabled = false;
  $("btnMine").disabled = false;
  $("fundStatus").textContent =
    "Funds keyfile downloaded. Store it offline, then send the ONE amount below to the burner.";
  startBalancePoll();
  project();
  renderBalance(funding.totalZat);
}

// ----- B4: mine + stage-2 keyfile + sign -----

async function mine() {
  if (!session.fundsKeyfileDownloaded || !session.burnerPriv) {
    throw new Error("generate burner + download funds keyfile first");
  }
  if (!table?.tip_hash) throw new Error("no tip_hash in table — publisher not ready");
  const work = +$("work").value;
  const patience = +$("patience").value;
  const money = +$("money").value;
  const tag = hexToBytes(session.burnerTagHex);
  const nIn = Math.max(1, burnerUtxos.length || 1);
  const fundPreview = fundingFromBid(table.floor_price_zat ?? 0, money, { nInMint: nIn });
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
  session.minedRecord = null;
  session.mintKeyfileDownloaded = false;

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
  const funding = fundingFromBid(floor, money, { nInMint: nIn });
  const retAddr = $("revealReturnAddr").value.trim();

  session.keyfile = buildKeyfile({
    stage: KEYFILE_STAGE_MINT,
    network: PAGE_NETWORK,
    commitment: bytesToHex(commitment),
    secret: bytesToHex(secret),
    seed: bytesToHex(seed),
    salt: bytesToHex(salt),
    work, patience, burn: 0, money,
    nonce: nonce.toString(),
    tag: session.burnerTagHex,
    burner: {
      priv_hex: bytesToHex(session.burnerPriv),
      address: session.burnerAddress,
      tag: session.burnerTagHex,
    },
    reveal_return_address: retAddr,
    challenge_height: table.tip_height,
    tip_hash: table.tip_hash,
    floor_zat: floor,
    pay_zat: pay,
    funding_zat: funding.totalZat,
    mint_fee_zat: funding.mintFeeZat,
    reveal_fee_zat: funding.revealFeeZat,
    valid_through_height: lastOk,
    mined_at: Math.floor(Date.now() / 1000),
  });
  session.minedRecord = {
    recordHex: bytesToHex(record),
    payZat: pay,
    funding,
    lastOk,
    bits,
  };

  $("mineStatus").textContent = "SOLUTION FOUND — download mint keyfile to continue";
  $("btnSaveKey").disabled = false;
  $("recordPending").textContent =
    KEYFILE_FUNDS_WARNING +
    " Stage-2 mint keyfile withheld OP_RETURN until download. It replaces stage 1 for reveal.";
}

function downloadMintKeyfile() {
  if (!session.keyfile || session.keyfile.stage !== KEYFILE_STAGE_MINT) return;
  forceDownload(
    session.keyfile,
    `zvault-mint-${session.keyfile.commitment.slice(0, 8)}.json`
  );
  session.mintKeyfileDownloaded = true;
  unlockRecordBox();
}

function unlockRecordBox() {
  const mr = session.minedRecord;
  if (!mr) return;
  $("recordBox").classList.remove("hidden");
  $("opreturn").textContent = mr.recordHex;
  const fund = mr.funding;
  $("payExact").textContent = `${formatZec(mr.payZat)} ZEC (${mr.payZat} zat)`;
  $("fundingExact").textContent =
    `${formatZec(fund.totalZat)} ZEC (${fund.totalZat} zat) — ONE send to burner`;
  const gate = $("fundingGate");
  if (burnerBalanceZat != null) {
    try {
      assertBurnerFunded(burnerBalanceZat, fund);
      gate.classList.add("hidden");
    } catch (e) {
      gate.textContent = String(e.message || e);
      gate.classList.remove("hidden");
    }
  }
  $("treasuryPay").textContent = TREASURY;
  $("deadline").textContent = String(mr.lastOk);
  $("cliCmd").textContent =
    `# Broadcast BEFORE block ${mr.lastOk}\n` +
    `# Treasury ${mr.payZat} zat → ${TREASURY}\n` +
    `# OP_RETURN:\n${mr.recordHex}\n`;
  $("recordPending").textContent =
    "Mint keyfile saved. Sign when funded; signed hex always shown (relay optional).";
  $("signedHex").textContent = "(not signed yet — click sign mint)";
}

function branchIdFromState() {
  if (!state?.consensus_nextblock) {
    throw new Error(
      "state.json missing consensus_nextblock — publisher must publish chain meta"
    );
  }
  return parseBranchId(state.consensus_nextblock);
}

async function signAndBroadcastMint() {
  if (!session.mintKeyfileDownloaded) throw new Error("download mint keyfile first");
  if (!session.minedRecord || !session.burnerPriv) throw new Error("nothing to sign");
  await pollBalanceOnce();
  if (!burnerUtxos.length) throw new Error("no UTXOs on burner — fund first");
  const kf = session.keyfile;
  const record = hexToBytes(session.minedRecord.recordHex);
  const net = PAGE_NETWORK === "main" ? "main" : "test";
  const branchId = branchIdFromState();
  const built = buildSignMint({
    utxos: burnerUtxos,
    payZat: kf.pay_zat,
    treasuryAddress: TREASURY,
    opReturnPayload: record,
    changeAddress: session.burnerAddress,
    network: net,
    consensusBranchId: branchId,
    nExpiryHeight: kf.valid_through_height || (table.tip_height + 20),
    priv: session.burnerPriv,
  });
  // Local structural check (node decode happens via relay mempool accept).
  parseTxV5(hxTx(built.hex));
  $("signedHex").textContent = built.hex;

  let txid = null;
  const base = relayBase();
  if (base) {
    txid = await relayBroadcast(base, built.hex);
    $("broadcastStatus").textContent = `Relayed txid=${txid}`;
  } else {
    $("broadcastStatus").textContent =
      "Signed. No relay URL configured (?relay=http://host:8091). Copy hex and broadcast yourself.";
  }
  session.mintTxid = txid;
  session.keyfile.mint_txid = txid || undefined;
  session.keyfile.mint_hex = built.hex;
  startStatusPoll();
  return txid;
}

// ----- B5: post-broadcast status -----

function findMintInTable(commitmentHex) {
  const bids = table?.epoch?.bids || [];
  for (const b of bids) {
    if (b.commitment === commitmentHex || b.commitment?.hex === commitmentHex) {
      return b;
    }
  }
  // state may list commitments
  for (const c of state?.commitments || []) {
    const h = typeof c === "string" ? c : c.commitment;
    if (h === commitmentHex) return c;
  }
  return null;
}

async function refreshPostStatus() {
  const box = $("postStatus");
  if (!session.keyfile?.commitment) {
    box.textContent = "No mint commitment in session — load a mint keyfile to track.";
    return;
  }
  try {
    await refreshTable();
  } catch (e) {
    box.textContent = `status: ${e.message || e}`;
    return;
  }
  const tip = table.tip_height;
  const c = session.keyfile.commitment;
  const hit = findMintInTable(c);
  const ep = table.epoch || {};
  let lines = [];
  lines.push(`tip ${tip} · digest ${(state.digest || "").slice(0, 12)}…`);
  if (session.mintTxid) lines.push(`mint txid ${session.mintTxid}`);
  if (!hit) {
    lines.push("mint not yet indexed — waiting for publisher confirmations");
  } else {
    const idx = hit.index ?? hit.mint_index ?? session.keyfile.mint_index;
    if (idx != null) {
      session.keyfile.mint_index = idx;
      $("revealIndex").value = String(idx);
      lines.push(`indexed as mint #${idx}`);
    } else {
      lines.push("commitment seen in table (index pending)");
    }
  }
  if (ep.open) {
    lines.push(
      `epoch #${ep.number} open ${ep.filled}/${ep.seats} · seal timeout ${ep.timeout_height} (${ep.timeout_height - tip} blocks)`
    );
  } else {
    lines.push(`epoch #${ep.number} — waiting for next seat / seal`);
  }
  const patience = session.keyfile.patience || 0;
  const mintH = session.keyfile.challenge_height;
  const unlock = mintH + patience * PATIENCE_UNIT;
  lines.push(
    patience === 0
      ? "patience 0 — reveal after epoch seal"
      : `patience unlock ≥ height ${unlock} (~${Math.max(0, unlock - tip)} blocks) — indexer enforces exact mint height + seal`
  );
  if (session.revealTxid) lines.push(`reveal txid ${session.revealTxid}`);
  box.textContent = lines.join("\n");
}

function startStatusPoll() {
  stopStatusPoll();
  refreshPostStatus();
  statusTimer = setInterval(refreshPostStatus, STATUS_POLL_MS);
}

function stopStatusPoll() {
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = null;
}

// ----- B6: reveal + abandon -----

async function signAndBroadcastReveal() {
  const kf = session.keyfile;
  if (!kf || !recoverFromKeyfile(kf).canReveal) {
    throw new Error("load a stage-2 mint keyfile first");
  }
  await refreshTable();
  await pollBalanceOnce();
  if (!burnerUtxos.length) throw new Error("no burner UTXOs left for reveal fee/change");
  const index = +$("revealIndex").value;
  const [a, b] = buildRevealChunks(
    index,
    hexToBytes(kf.secret),
    hexToBytes(kf.seed),
    hexToBytes(kf.salt),
  );
  $("revealA").textContent = bytesToHex(a);
  $("revealB").textContent = bytesToHex(b);
  $("revealOut").classList.remove("hidden");

  const ret = kf.reveal_return_address || $("revealReturnAddr").value.trim();
  if (!ret) throw new Error("return address required for reveal change");
  const priv = session.burnerPriv || hexToBytes(kf.burner.priv_hex);
  const net = PAGE_NETWORK === "main" ? "main" : "test";
  const built = buildSignReveal({
    utxos: burnerUtxos,
    chunkA: a,
    chunkB: b,
    returnAddress: ret,
    network: net,
    consensusBranchId: branchIdFromState(),
    nExpiryHeight: (table.tip_height || 0) + 20,
    priv,
  });
  parseTxV5(hxTx(built.hex));
  $("revealSigned").textContent = built.hex;

  const base = relayBase();
  if (base) {
    const txid = await relayBroadcast(base, built.hex);
    session.revealTxid = txid;
    $("revealStatus").textContent = `Reveal relayed txid=${txid}`;
  } else {
    $("revealStatus").textContent =
      "Reveal signed. Copy hex and broadcast (no relay configured).";
  }
}

async function abandonSweep() {
  const ret = $("revealReturnAddr").value.trim();
  if (!ret || !session.burnerPriv) throw new Error("return address + burner required");
  await pollBalanceOnce();
  if (!burnerUtxos.length) throw new Error("nothing to sweep");
  const net = PAGE_NETWORK === "main" ? "main" : "test";
  const built = buildSignAbandonSweep({
    utxos: burnerUtxos,
    destAddress: ret,
    network: net,
    consensusBranchId: branchIdFromState(),
    nExpiryHeight: (table?.tip_height || 0) + 20,
    priv: session.burnerPriv,
  });
  $("signedHex").textContent = built.hex;
  $("recordBox").classList.remove("hidden");
  const base = relayBase();
  if (base) {
    const txid = await relayBroadcast(base, built.hex);
    $("broadcastStatus").textContent = `Abandon-sweep txid=${txid}`;
  } else {
    $("broadcastStatus").textContent = "Abandon-sweep signed — broadcast the hex yourself.";
  }
}

// ----- B7: resume from keyfile -----

async function resumeFromKeyfile(entry) {
  const rec = recoverFromKeyfile(entry);
  session.keyfile = entry;
  if (rec.burnerPrivHex) {
    session.burnerPriv = hexToBytes(rec.burnerPrivHex);
  }
  session.burnerAddress = rec.burnerAddress;
  session.burnerTagHex = rec.minerTag;
  session.fundsKeyfileDownloaded = true;
  if (rec.revealReturnAddress) {
    $("revealReturnAddr").value = rec.revealReturnAddress;
  }
  if (session.burnerAddress) {
    $("burnerBox").classList.remove("hidden");
    $("burnerAddr").textContent = session.burnerAddress;
    $("burnerTag").textContent = session.burnerTagHex || "—";
    $("btnPollBal").disabled = false;
    startBalancePoll();
  }
  $("revealMeta").textContent =
    `stage=${rec.stage} · commitment ${(entry.commitment || "").slice(0, 16) || "(funds only)"}… · tag ${rec.minerTag || "—"}`;

  if (rec.stage === KEYFILE_STAGE_FUNDS) {
    $("mineStatus").textContent = "Resumed stage-1 funds keyfile — fund burner, then mine.";
    $("btnMine").disabled = false;
    return;
  }

  // Stage mint
  session.mintKeyfileDownloaded = true;
  if (entry.pay_zat != null && entry.commitment) {
    session.minedRecord = {
      recordHex: entry.record_hex || null,
      payZat: entry.pay_zat,
      funding: {
        totalZat: entry.funding_zat,
        payZat: entry.pay_zat,
        mintFeeZat: entry.mint_fee_zat,
        revealFeeZat: entry.reveal_fee_zat,
        bufferZat: 10000,
      },
      lastOk: entry.valid_through_height,
    };
    // Rebuild record if missing
    if (!session.minedRecord.recordHex && entry.nonce != null) {
      const record = buildRecord(
        hexToBytes(entry.commitment),
        BigInt(entry.nonce),
        entry.work,
        entry.patience,
        entry.burn || 0,
        entry.money,
        hexToBytes(entry.tag),
      );
      session.minedRecord.recordHex = bytesToHex(record);
    }
    if (session.minedRecord.recordHex) unlockRecordBox();
  }
  if (entry.mint_hex) $("signedHex").textContent = entry.mint_hex;
  if (entry.mint_txid) session.mintTxid = entry.mint_txid;
  if (entry.mint_index != null) $("revealIndex").value = String(entry.mint_index);
  startStatusPoll();
  $("mineStatus").textContent =
    entry.mint_txid
      ? "Resumed minted keyfile — tracking status / ready to reveal."
      : "Resumed mined-not-broadcast — sign when funded.";
}

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

function loadKeyfile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        resolve(Array.isArray(data) ? data[0] : data);
      } catch (e) { reject(e); }
    };
    r.onerror = reject;
    r.readAsText(file);
  });
}

function copyText(id) {
  navigator.clipboard.writeText($(id).textContent);
}

async function boot() {
  assertTreasuryForNetwork(TREASURY, PAGE_NETWORK);
  $("trust").textContent =
    "Static page. Fetches same-origin table/state/utxos only. " +
    "Burner keys never upload. Treasury is network-scoped in source. " +
    `Network=${PAGE_NETWORK}. UTXOs come from the publisher block scan (Tatum has no address index).`;
  $("treasuryBid").textContent = TREASURY;

  if (window.__pubUrlError) {
    $("tableErr").textContent = String(window.__pubUrlError.message || window.__pubUrlError);
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
  $("work").value = String(MAX_WORK_BITS);
  $("patience").max = MAX_PATIENCE;
  $("money").max = MAX_MONEY;
  ["work", "patience", "money"].forEach((id) => $(id).addEventListener("input", () => {
    project();
    if (session.burnerAddress) {
      const floor = table?.floor_price_zat ?? 0;
      const need = fundingFromBid(floor, +$("money").value, {
        nInMint: Math.max(1, burnerUtxos.length || 1),
      }).totalZat;
      renderBalance(need);
    }
  }));

  $("btnRefresh").onclick = () => refreshTable().catch((e) => alert(e));
  $("btnGenBurner").onclick = () => {
    try { generateBurnerFlow(); } catch (e) { alert(e); console.error(e); }
  };
  $("btnPollBal").onclick = () => pollBalanceOnce().catch((e) => alert(e));
  $("btnMine").onclick = () => mine().catch((e) => {
    $("mineStatus").textContent = String(e.message || e);
    console.error(e);
  });
  $("btnSaveKey").onclick = downloadMintKeyfile;
  $("btnSignMint").onclick = () => signAndBroadcastMint().catch((e) => {
    $("broadcastStatus").textContent = String(e.message || e);
    console.error(e);
  });
  $("btnAbandon").onclick = () => abandonSweep().catch((e) => alert(e));
  $("btnCopyOp").onclick = () => copyText("opreturn");
  $("btnCopyCli").onclick = () => copyText("cliCmd");
  $("btnCopySigned").onclick = () => copyText("signedHex");

  $("keyfileInput").onchange = async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const entry = await loadKeyfile(f);
      window.__revealKey = entry;
      await resumeFromKeyfile(entry);
    } catch (e) { alert(e); console.error(e); }
  };
  $("btnResume").onclick = async () => {
    if (!window.__revealKey) return alert("load a keyfile first");
    try { await resumeFromKeyfile(window.__revealKey); } catch (e) { alert(e); }
  };
  $("btnReveal").onclick = () => {
    if (!session.keyfile && !window.__revealKey) return alert("load a keyfile first");
    if (window.__revealKey && !session.keyfile) {
      resumeFromKeyfile(window.__revealKey).then(() => signAndBroadcastReveal())
        .catch((e) => { $("revealStatus").textContent = String(e.message || e); });
      return;
    }
    signAndBroadcastReveal().catch((e) => {
      $("revealStatus").textContent = String(e.message || e);
      console.error(e);
    });
  };
  $("btnCopyRev").onclick = () => copyText("revealSigned");
  $("btnWatchPunk").onclick = () => {
    watchMyPunk(+$("revealIndex").value).catch((e) => alert(e));
  };

  console.log("ZVAULT app boot OK", { network: PAGE_NETWORK, treasury: TREASURY });
}

boot();
