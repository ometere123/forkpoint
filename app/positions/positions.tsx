'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ADDRESS, CHAIN, errorMessage, formatGen, getPosition, readMarkets, type Market, type Position } from '../../lib/chain';
import { Availability, History, Status } from '../shared';
import { useWallet } from '../wallet';

type Holder = { market: Market; position: Position };
export function Positions() {
  const { account, chain, busy, revision, submit } = useWallet();
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [rows, setRows] = useState<Holder[]>();
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    let stopped = false;
    setRows(undefined); setError('');
    if (!ADDRESS || !account) return;
    readMarkets(page).then(async data => {
      if (stopped) return;
      const holdings = await Promise.all(data.markets.map(async market => ({ market, position: await getPosition(market.id, account) })));
      if (!stopped) { setCount(data.count); setRows(holdings.filter((row): row is Holder => !!row.position)); }
    }).catch(error => { if (!stopped) setError(errorMessage(error)); });
    return () => { stopped = true; };
  }, [account, page, revision]);
  const claim = async (id: number) => {
    setActionError('');
    try { await submit({ method: 'claim', args: [id], market: id }); }
    catch (error) { setActionError(errorMessage(error)); }
  };

  return <section className="wrap page">
    <div className="page-head"><div><p className="eyebrow">Portfolio</p><h1>My positions</h1><p className="lede">Review your stakes, claimable payouts and wallet transactions.</p></div></div>
    <Availability />
    {!account && <p className="callout">Connect your wallet to see your positions.</p>}
    {ADDRESS && account && <>
      <section aria-labelledby="holdings"><h2 id="holdings">Positions</h2>
        <p className="muted">Contract positions are checked 12 markets at a time, newest first.</p>
        {error && <p className="callout alert" role="alert">{error}</p>}
        {actionError && <p className="callout alert" role="alert">{actionError}</p>}
        {!error && !rows && <p role="status">Loading positions…</p>}
        {rows?.length === 0 && <p className="callout">No positions in this group of markets.</p>}
        <div className="market-grid">
          {rows?.map(({ market, position }) => <article className="market-card" key={market.id}>
            <Status state={market.state} /><h3><Link href={`/markets/${market.id}`}>{market.feature}</Link></h3>
            <p>{position.yes ? 'YES' : 'NO'} · {formatGen(position.stake)} stake</p>
            {position.dispatched ? <p>Payout dispatched · Recipient credit unconfirmed</p> : <p>{formatGen(position.claimable)} claimable</p>}
            {!position.dispatched && BigInt(position.claimable) > 0n && <button className="button primary" disabled={busy || chain !== CHAIN} onClick={() => claim(market.id)}>Claim payout</button>}
            <Link className="inline-link" href={`/markets/${market.id}`}>Market details <ArrowRight size={15} /></Link>
          </article>)}
        </div>
        {count > 12 && <div className="actions pagination"><button className="button small secondary" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><span>Markets {page * 12 + 1}–{Math.min(count, (page + 1) * 12)} of {count}</span><button className="button small secondary" disabled={(page + 1) * 12 >= count} onClick={() => setPage(value => value + 1)}>Next</button></div>}
      </section>
      <section className="panel" aria-labelledby="history"><h2 id="history">Transaction history</h2><History /></section>
    </>}
  </section>;
}
