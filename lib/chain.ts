import { abi, createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { CalldataAddress, TransactionHashVariant, type CalldataEncodable } from 'genlayer-js/types';

export type Hex = `0x${string}`;
export const CHAIN = '0xf22f';
export const RPC = 'https://studio.genlayer.com/api';
export const EXPLORER = 'https://explorer-studio.genlayer.com';
export const isAddress = (input: unknown): input is Hex => typeof input === 'string' && /^0x[\da-f]{40}$/i.test(input) && !/^0x0{40}$/.test(input);
export const isHash = (input: unknown): input is Hex => typeof input === 'string' && /^0x[\da-f]{64}$/i.test(input);
const configured = process.env.NEXT_PUBLIC_FORKPOINT_CONTRACT;
export const ADDRESS = isAddress(configured) ? configured : null;
const readClient = createClient({ chain: studionet, endpoint: RPC });

export type MarketSpec = {
  trigger_repo_id: number; pr_number: number; target_repo_id: number; release_tag: string; feature: string;
  criteria: { path: string; needle: string }[];
  cutoff: number; trigger_deadline: number; outcome_deadline: number; stake: string; limit: number;
};
export type Market = MarketSpec & {
  id: number; state: string; stored_state: string; created_at: number; yes_count: number; no_count: number;
  trigger_window_start: number; trigger_window_end: number; outcome_window_start: number; outcome_window_end: number;
  trigger_slot: number; outcome_slot: number; slot_seconds: number; merged_at: number | null;
  evidence?: { trigger: Evidence[]; outcome: Evidence[]; expiration: unknown }; policy?: string;
};
export type Evidence = { slot: number; checked_at: number; facts: { verdict: string; reason: string; sources?: string[] } };
export type Position = {
  yes: boolean; stake: string; claimable: string; dispatched: boolean; dispatched_amount?: string;
  dispatched_at?: number | null; payout_status?: string;
};
export type Method = 'create_market' | 'predict' | 'check_trigger' | 'check_outcome' | 'expire' | 'claim';

type WalletRequest = { method: string; params?: readonly unknown[] | object };
export type Wallet = {
  request(args: WalletRequest): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};
declare global { interface Window { ethereum?: Wallet } }

export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message.slice(0, 320);
  return 'The request could not be completed.';
}

export function needAddress(): Hex {
  if (!ADDRESS) throw new Error('Studionet contract unavailable');
  return ADDRESS;
}

async function read(method: string, args: CalldataEncodable[] = []) {
  return readClient.readContract({
    address: needAddress(), functionName: method, args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
}
async function readJson<T>(method: string, args: CalldataEncodable[]): Promise<T> {
  const result = await read(method, args);
  if (typeof result !== 'string') throw new Error('Unexpected contract response.');
  return JSON.parse(result) as T;
}
export async function marketCount() {
  const result = await read('market_count');
  if (typeof result !== 'number' && typeof result !== 'bigint' && (typeof result !== 'string' || !/^\d+$/.test(result))) {
    throw new Error('Unexpected market count.');
  }
  const count = Number(result);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Unexpected market count.');
  return count;
}
export const getMarket = (id: number) => readJson<Market>('get_market', [id]);
export const getPosition = (id: number, wallet: Hex) => readJson<Position | null>('get_position', [id, new CalldataAddress(Uint8Array.from(wallet.slice(2).match(/../g)!, pair => parseInt(pair, 16)))]);
export async function readMarkets(page: number) {
  const count = await marketCount();
  const start = count - page * 12;
  const ids = Array.from({ length: Math.max(0, Math.min(start, 12)) }, (_, i) => start - i - 1);
  return { count, markets: await Promise.all(ids.map(getMarket)) };
}

export async function getWalletState(provider: Wallet) {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' }),
  ]);
  const first: unknown = Array.isArray(accounts) ? accounts[0] : null;
  return { account: isAddress(first) ? first : null, chain: typeof chain === 'string' ? chain.toLowerCase() : null };
}

export async function switchChain(provider: Wallet) {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN }] });
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 4902) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: CHAIN, chainName: 'GenLayer Studionet', nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
      rpcUrls: [RPC], blockExplorerUrls: [EXPLORER],
    }] });
    if ((await getWalletState(provider)).chain !== CHAIN) {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN }] });
    }
  }
}

export async function write(provider: Wallet, account: Hex, method: Method, args: CalldataEncodable[], value: bigint, signing: (fee: bigint) => void) {
  const assertWallet = async () => {
    const state = await getWalletState(provider);
    if (state.chain !== CHAIN) throw new Error('Switch your wallet to Studionet 61999.');
    if (state.account?.toLowerCase() !== account.toLowerCase()) throw new Error('The connected account changed.');
  };
  await assertWallet();
  const protectedProvider = {
    request: async (request: WalletRequest) => {
      if (request.method !== 'eth_sendTransaction') return provider.request(request);
      const params = Array.isArray(request.params) ? request.params[0] : null;
      if (!params || !isAddress(params.to) || typeof params.data !== 'string') throw new Error('Invalid signing request.');
      // The SDK estimates gas but can fall back to a default. Require an RPC estimate
      // for the exact transaction and pass its gas limit to the injected wallet.
      const [gas, gasPrice] = await Promise.all([
        readClient.estimateTransactionGas({ from: account, to: params.to, data: params.data, value }),
        readClient.getGasPrice(),
      ]);
      await assertWallet();
      signing(gas * gasPrice);
      return provider.request({ method: 'eth_sendTransaction', params: [{ ...params, gas: `0x${gas.toString(16)}`, gasPrice: `0x${gasPrice.toString(16)}`, chainId: CHAIN }] });
    },
  };
  const client = createClient({
    chain: studionet, account, endpoint: RPC,
    provider: protectedProvider as NonNullable<NonNullable<Parameters<typeof createClient>[0]>['provider']>,
  });
  const hash: unknown = await client.writeContract({ address: needAddress(), functionName: method, args, value });
  if (!isHash(hash)) throw new Error('The wallet did not return a valid transaction hash.');
  return hash;
}

type ReceiptRecord = { mode?: string; execution_result?: string };
type TxRecord = {
  hash?: Hex; status?: string; statusName?: string; from_address?: Hex; to_address?: Hex; data?: { calldata?: string };
  consensus_data?: { leader_receipt?: ReceiptRecord | ReceiptRecord[] };
  triggered_by?: Hex; triggered_transactions?: unknown[]; value?: string | number; value_credited?: boolean;
};
async function rpc(method: string, params: unknown[]) {
  const response = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(12_000), redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) throw new Error('Studionet RPC unavailable.');
  // Studio serializes wei as a JSON number. Preserve its source digits when
  // supported. On older browsers, unsafe numbers remain unconfirmed.
  const json: { result?: unknown; error?: { message?: string } } = JSON.parse(await response.text(),
    (key: string, value: unknown, context?: { source?: string }) =>
      key === 'value' && typeof value === 'number' && /^\d+$/.test(context?.source ?? '') ? context!.source : value);
  if (json.error) throw new Error(json.error.message ?? 'Studionet RPC rejected the request.');
  return json.result;
}
export async function latestBlockTimestamp() {
  const block = await rpc('eth_getBlockByNumber', ['latest', false]) as { timestamp?: unknown } | null;
  const timestamp = typeof block?.timestamp === 'string' && /^0x[\da-f]+$/i.test(block.timestamp)
    ? Number(block.timestamp) : NaN;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('Studionet time is unavailable.');
  return timestamp;
}
async function calldataDigest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function intentDigest(method: Method, args: CalldataEncodable[]) {
  return calldataDigest(abi.calldata.encode(abi.calldata.makeCalldataObject(method, args, undefined)));
}
function exactValue(value?: number | string) {
  return typeof value === 'number' && !Number.isSafeInteger(value) ? null : value;
}
function executionResult(receipts: ReceiptRecord | ReceiptRecord[] | undefined) {
  if (Array.isArray(receipts)) {
    return (receipts.find(receipt => receipt?.mode === 'leader') ?? receipts.find(receipt => receipt?.execution_result))?.execution_result;
  }
  return receipts?.execution_result;
}
export async function getReceipt(hash: Hex, account: Hex, digest: string, value: string) {
  const tx = await rpc('eth_getTransactionByHash', [hash]) as TxRecord | null;
  if (!tx) return { phase: 'Submitted', children: [] as Hex[] };
  if (tx.hash?.toLowerCase() !== hash.toLowerCase() || tx.from_address?.toLowerCase() !== account.toLowerCase()
    || tx.to_address?.toLowerCase() !== needAddress().toLowerCase()) {
    return { phase: 'Unexpected transaction', children: [] as Hex[] };
  }
  if (!tx.data?.calldata || exactValue(tx.value) === null) return { phase: 'Calldata or value unverified', children: [] as Hex[] };
  const actual = await calldataDigest(Uint8Array.from(atob(tx.data.calldata), char => char.charCodeAt(0)));
  if (actual !== digest || String(exactValue(tx.value)) !== value) return { phase: 'Unexpected transaction', children: [] as Hex[] };
  const status = tx.statusName ?? tx.status ?? 'Submitted';
  const children = (tx.triggered_transactions ?? []).filter(isHash);
  if (status !== 'FINALIZED') {
    return { phase: ['CANCELED', 'CANCELLED', 'UNDETERMINED'].includes(status) ? 'Execution failed' : status, children };
  }
  const receipts = tx.consensus_data?.leader_receipt;
  const result = executionResult(receipts);
  return { phase: result === 'SUCCESS' ? 'Finalized · Success' : result ? 'Execution failed' : 'Finalized · Execution unverified', children };
}
export async function deliveryStatus(parent: Hex, children: Hex[], account: Hex, market: number) {
  if (!children.length) return 'Awaiting transfer receipt';
  const position = await getPosition(market, account);
  if (!position?.dispatched || !position.dispatched_amount) return 'Payout readback pending';
  for (const hash of children) {
    const tx = await rpc('eth_getTransactionByHash', [hash]) as TxRecord | null;
    if (!tx || tx.hash?.toLowerCase() !== hash.toLowerCase() || (tx.triggered_by && tx.triggered_by.toLowerCase() !== parent.toLowerCase()) || tx.from_address?.toLowerCase() !== needAddress().toLowerCase() || tx.to_address?.toLowerCase() !== account.toLowerCase()) continue;
    if (String(exactValue(tx.value)) !== position.dispatched_amount) continue;
    const receipts = tx.consensus_data?.leader_receipt;
    const result = executionResult(receipts);
    const status = tx.statusName ?? tx.status;
    if (status === 'FINALIZED' && tx.value_credited === true && (!result || result === 'SUCCESS')) return 'Recipient credit verified';
    if (status === 'FINALIZED' && result && result !== 'SUCCESS' || status === 'CANCELED' || status === 'UNDETERMINED') return 'Transfer failed · No automatic retry';
  }
  return 'Recipient credit unverified';
}
export const transactionLink = (hash: Hex) => `${EXPLORER}/tx/${hash}`;
export function formatGen(wei: string | bigint) {
  const amount = BigInt(wei);
  const division = 10n ** 18n;
  const tail = (amount % division).toString().padStart(18, '0').replace(/0+$/, '');
  return `${amount / division}${tail ? '.' + tail : ''} GEN`;
}







