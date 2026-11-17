'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ADDRESS, CHAIN, deliveryStatus, errorMessage, getReceipt, getWalletState, intentDigest, isAddress, isHash, switchChain, write, type Hex, type Method, type Wallet } from '../lib/chain';
import type { CalldataEncodable } from 'genlayer-js/types';

type Entry = { key: string; account: Hex; hash?: Hex; phase: string; date: number; children?: Hex[]; delivery?: string; finalizedAt?: number; digest: string; value: string; estimatedFee?: string };
type Action = { method: Method; args: CalldataEncodable[]; value?: bigint; market?: number };
type Connection = {
  account: Hex | null; chain: string | null; walletError: string; busy: boolean; ready: boolean;
  entries: Entry[]; revision: number; connect: () => Promise<void>; switchWallet: () => Promise<void>; disconnect: () => void;
  submit: (action: Action) => Promise<void>; recover: (entry: Entry, hash: string) => void; refreshReceipts: () => void;
};
const key = `forkpoint:61999:${ADDRESS?.toLowerCase()}:v2`;
const disconnectedKey = 'forkpoint:disconnected';
const terminal = new Set(['Finalized · Success', 'Execution failed', 'Unexpected transaction']);
const Context = createContext<Connection | null>(null);

function load(): Entry[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry): entry is Entry => !!entry && isAddress(entry.account)
      && typeof entry.key === 'string' && typeof entry.date === 'number' && typeof entry.phase === 'string'
      && typeof entry.digest === 'string' && typeof entry.value === 'string'
      && (entry.hash === undefined || isHash(entry.hash))).slice(-100);
  } catch {
    return [];
  }
}
function save(entries: Entry[]) {
  const pending = entries.filter(entry => !terminal.has(entry.phase));
  if (pending.length >= 100) throw new Error('Transaction storage is full. Wait for existing writes to finalize.');
  localStorage.setItem(key, JSON.stringify([...entries.filter(entry => terminal.has(entry.phase)).slice(-(100 - pending.length)), ...pending]));
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<Hex | null>(null);
  const [chain, setChain] = useState<string | null>(null);
  const [walletError, setWalletError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [revision, setRevision] = useState(0);
  const [manualPollSince, setManualPollSince] = useState(0);
  const writing = useRef(false);
  const detached = useRef(false);
  const generation = useRef(0);
  const invalidateGeneration = () => { generation.current += 1; };

  useEffect(() => {
    if (window.ethereum) setProvider(window.ethereum);
    const receiveWallet = () => { if (window.ethereum) setProvider(current => current ?? window.ethereum ?? null); };
    const announced = (event: Event) => {
      const detail = (event as CustomEvent<{ provider?: Wallet }>).detail;
      if (detail?.provider && typeof detail.provider.request === 'function') {
        setProvider(current => current ?? detail.provider ?? null);
      }
    };
    const storeChanged = () => { setEntries(load()); setRevision(current => current + 1); };
    try { detached.current = sessionStorage.getItem(disconnectedKey) === 'yes'; } catch {}
    setEntries(load());
    setReady(true);
    window.addEventListener('ethereum#initialized', receiveWallet);
    window.addEventListener('eip6963:announceProvider', announced);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    window.addEventListener('storage', storeChanged);
    return () => {
      window.removeEventListener('ethereum#initialized', receiveWallet);
      window.removeEventListener('eip6963:announceProvider', announced);
      window.removeEventListener('storage', storeChanged);
    };
  }, []);

  useEffect(() => {
    if (!provider) return;
    const sync = async () => {
      const ticket = ++generation.current;
      try {
        const state = await getWalletState(provider);
        if (ticket === generation.current && !detached.current) {
          setAccount(state.account); setChain(state.chain);
        }
      } catch (error) { if (ticket === generation.current) setWalletError(errorMessage(error)); }
    };
    const lost = () => { invalidateGeneration(); setAccount(null); setChain(null); };
    void sync();
    provider.on?.('accountsChanged', sync);
    provider.on?.('chainChanged', sync);
    provider.on?.('disconnect', lost);
    provider.on?.('connect', sync);
    return () => {
      invalidateGeneration();
      provider.removeListener?.('accountsChanged', sync);
      provider.removeListener?.('chainChanged', sync);
      provider.removeListener?.('disconnect', lost);
      provider.removeListener?.('connect', sync);
    };
  }, [provider]);

  useEffect(() => {
    if (!ready || !ADDRESS) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const tracked = load().filter(entry => entry.hash && (!terminal.has(entry.phase) || (
        entry.key.startsWith('claim:') && entry.phase === 'Finalized · Success'
        && entry.delivery !== 'Recipient credit verified' && !entry.delivery?.includes('failed')
        && Date.now() - Math.max(manualPollSince, entry.finalizedAt ?? entry.date) < 15 * 60_000
      )));
      await Promise.allSettled(tracked.map(async entry => {
        const receipt = await getReceipt(entry.hash!, entry.account, entry.digest, entry.value);
        const delivery = entry.key.startsWith('claim:') && receipt.phase === 'Finalized · Success'
          ? await deliveryStatus(entry.hash!, receipt.children, entry.account, Number(entry.key.split(':')[1])).catch(() => 'Recipient credit unverified')
          : undefined;
        if (stopped || (receipt.phase === entry.phase && delivery === entry.delivery && JSON.stringify(receipt.children) === JSON.stringify(entry.children))) return;
        const latest = load();
        const finalizedAt = receipt.phase === 'Finalized · Success' ? entry.finalizedAt ?? Date.now() : undefined;
        const updated = latest.map(item => item.hash === entry.hash ? { ...item, ...receipt, delivery, finalizedAt } : item);
        save(updated);
        setEntries(updated);
        if (terminal.has(receipt.phase) && receipt.phase !== entry.phase) setRevision(value => value + 1);
      }));
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [ready, manualPollSince]);

  const connect = async () => {
    const selected = provider ?? window.ethereum;
    if (!selected) { setWalletError('No injected wallet detected. Open this site in an EIP-1193 wallet browser.'); return; }
    setWalletError('');
    try {
      await selected.request({ method: 'eth_requestAccounts' });
      const state = await getWalletState(selected);
      if (!state.account) throw new Error('The wallet returned no account.');
      detached.current = false;
      try { sessionStorage.removeItem(disconnectedKey); } catch {}
      setProvider(selected); setAccount(state.account); setChain(state.chain);
    } catch (error) { setWalletError(errorMessage(error)); }
  };

  const switchWallet = async () => {
    if (!provider) return;
    try { await switchChain(provider); setChain((await getWalletState(provider)).chain); setWalletError(''); }
    catch (error) { setWalletError(errorMessage(error)); }
  };

  const disconnect = () => {
    detached.current = true;
    ++generation.current;
    try { sessionStorage.setItem(disconnectedKey, 'yes'); } catch {}
    setAccount(null); setChain(null); setWalletError('');
  };

  const submit = async ({ method, args, value = 0n, market }: Action) => {
    if (!provider || !account || detached.current) throw new Error('Connect your wallet first.');
    if (chain !== CHAIN) throw new Error('Switch your wallet to Studionet 61999.');
    if (!ready || writing.current) throw new Error('A write is already being prepared.');
    const actionKey = `${method}:${market ?? ''}`;
    writing.current = true;
    setBusy(true);
    try {
      // Web Locks serialize signing across tabs where available. Persistent action
      // records also guard refreshes and writes from another page in this tab.
      const run = async () => {
        const current = load();
        if (current.some(entry => entry.account.toLowerCase() === account.toLowerCase() && !terminal.has(entry.phase))) {
          throw new Error('A write is already pending for this wallet. Check transaction history.');
        }
        const entry: Entry = { date: Date.now(), account, key: actionKey, phase: 'Preparing gas estimate', digest: await intentDigest(method, args), value: value.toString() };
        const setEntry = (phase: string, hash?: Hex) => {
          const updated = [...load().filter(item => item.date !== entry.date || item.account !== account), { ...entry, phase, hash }];
          save(updated);
          setEntries(updated);
        };
        setEntry('Preparing gas estimate');
        let requested = false;
        try {
          const hash = await write(provider, account, method, args, value, fee => {
            if (detached.current) throw new Error('The wallet was disconnected before signing.');
            entry.estimatedFee = fee.toString();
            requested = true;
            setEntry('Awaiting wallet');
          });
          setEntry('Submitted', hash);
        } catch (error) {
          const rejected = typeof error === 'object' && error !== null && 'code' in error && error.code === 4001;
          setEntry(requested && !rejected ? 'Submission unverified' : 'Execution failed');
          throw error;
        }
      };
      if (navigator.locks) await navigator.locks.request(key, run);
      else await run();
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  const recover = (entry: Entry, hash: string) => {
    if (!account || writing.current || entry.hash || entry.account.toLowerCase() !== account.toLowerCase()) return;
    if (hash && !isHash(hash)) throw new Error('Enter the Studionet transaction hash from your wallet.');
    const updated = load().map(item => item.date === entry.date && item.account === entry.account && !item.hash
      ? { ...item, hash: hash ? hash as Hex : undefined, phase: hash ? 'Submitted' : 'Execution failed' } : item);
    save(updated);
    setEntries(updated);
  };

  return <Context.Provider value={{ account, chain, busy, ready, walletError, entries, revision, connect, switchWallet, disconnect, submit, recover, refreshReceipts: () => setManualPollSince(Date.now()) }}>{children}</Context.Provider>;
}

export function useWallet() {
  const context = useContext(Context);
  if (!context) throw new Error('Wallet provider missing.');
  return context;
}





