'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { GitFork, Wallet, ArrowUpRight } from 'lucide-react';
import { CHAIN } from '../lib/chain';
import { useWallet } from './wallet';

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { account, chain, walletError, connect, switchWallet, disconnect } = useWallet();
  useEffect(() => {
    document.documentElement.dataset.forkpointHydrated = 'true';
    return () => { delete document.documentElement.dataset.forkpointHydrated; };
  }, []);
  return <>
    <a className="skip" href="#main">Skip to content</a>
    <header className="site-head"><div className="wrap nav">
      <Link className="brand" href="/" aria-label="FORKPOINT home"><span className="brand-icon"><GitFork size={18} /></span>FORKPOINT</Link>
      <nav aria-label="Main navigation">
        <Link href="/markets" aria-current={path.includes('/markets') && path !== '/markets/new' ? 'page' : undefined}>Markets</Link>
        <Link href="/markets/new" aria-current={path === '/markets/new' ? 'page' : undefined}>Create</Link>
        <Link href="/positions" aria-current={path === '/positions' ? 'page' : undefined}>My positions</Link>
      </nav>
      <div className="wallet">
        {!account && <button className="button small secondary" onClick={connect}><Wallet size={17} /> Connect wallet</button>}
        {account && chain !== CHAIN && <button className="button small primary" onClick={switchWallet}>Switch to Studionet</button>}
        {account && <button className="button small secondary" onClick={disconnect} title={account} aria-label="Disconnect"><Wallet size={16} /> <span>{account.slice(0,6)}…{account.slice(-4)}</span><span className="disconnect-label"> · Disconnect</span></button>}
      </div>
    </div></header>
    {walletError && <p role="alert" className="wrap callout alert top-alert">{walletError}</p>}
    {account && chain !== CHAIN && <p role="status" className="wrap callout top-alert">Wrong network. Switch to Studionet 61999 to sign transactions.</p>}
    <main id="main" tabIndex={-1}>{children}</main>
    <footer className="site-foot"><div className="wrap footer-layout">
      <Link className="brand" href="/"><span className="brand-icon"><GitFork size={18} /></span>FORKPOINT</Link>
      <span>Conditional GitHub markets on GenLayer Studionet.</span>
      <a href="https://explorer-studio.genlayer.com" target="_blank" rel="noreferrer">Studionet explorer <ArrowUpRight size={15} /></a>
    </div></footer>
  </>;
}

