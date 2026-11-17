'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowUpRight, GitMerge, Plus, Search } from 'lucide-react';
import { ADDRESS, errorMessage, formatGen, readMarkets, type Market } from '../../lib/chain';
import { useWallet } from '../wallet';
import { Availability, statusLabel, Status } from '../shared';

export function Explorer() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ markets: Market[]; count: number }>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const { revision } = useWallet();
  useEffect(() => {
    if (!ADDRESS) return;
    let stale = false;
    setError(''); setData(undefined);
    readMarkets(page).then(value => { if (!stale) setData(value); }).catch(reason => { if (!stale) setError(errorMessage(reason)); });
    return () => { stale = true; };
  }, [page, refresh, revision]);

  const term = query.trim().toLowerCase();
  const results = data?.markets.filter(m => (!state || m.state === state)
    && (!term || [m.feature, m.release_tag, m.trigger_repo_id, m.target_repo_id, m.pr_number, m.id].some(v => String(v).toLowerCase().includes(term))));
  return <section className="wrap page">
    <div className="page-head"><div><p className="eyebrow"><span className="signal" /> Studionet 61999</p><h1>Markets</h1><p className="lede">Explore open-source predictions and see how they settle.</p></div><Link href="/markets/new" className="button primary"><Plus size={19} /> Create a market</Link></div>
    <Availability />
    {ADDRESS && <>
      <div className="filter-row">
        <label className="search-field"><Search size={17} /><span className="sr-only">Search this page</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search markets on this page" /></label>
        <label><span className="sr-only">Filter by status</span><select value={state} onChange={event => setState(event.target.value)}><option value="">All statuses</option>
          {['CREATED', 'PREDICTIONS_CLOSED', 'TRIGGER_CHECK', 'ACTIVE', 'OUTCOME_CHECK', 'RESOLVED_YES', 'RESOLVED_NO', 'VOID', 'INCONCLUSIVE'].map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
        <button className="button small secondary" onClick={() => setRefresh(value => value + 1)}>Refresh</button>
      </div>
      {error && <p role="alert" className="callout alert">Could not read market data. {error}</p>}
      {!data && !error && <p role="status" className="callout">Loading markets…</p>}
      {data?.count === 0 && <div className="empty"><GitMerge /><h2>No markets yet</h2><p>New markets appear here when creation finalizes.</p><Link href="/markets/new" className="button primary">Create a market <ArrowRight size={17} /></Link></div>}
      {data && data.count > 0 && results?.length === 0 && <p className="callout">No matching markets on this page.</p>}
      <div className="market-grid">{results?.map(m => <article className="market-card" key={m.id}>
        <div className="market-top"><span>Market #{m.id}</span><Status state={m.state} /></div>
        <h2><Link href={`/markets/${m.id}`}>{m.feature}</Link></h2>
        <p><GitMerge size={16} /> Repo {m.trigger_repo_id} · PR #{m.pr_number}</p>
        <div className="market-bottom"><span>{formatGen(m.stake)} stake <span aria-hidden="true">·</span> {m.yes_count + m.no_count}/{m.limit} positions</span><Link href={`/markets/${m.id}`} aria-label={`Open market ${m.id}`}><ArrowUpRight size={20} /></Link></div>
      </article>)}</div>
      {data && data.count > 12 && <div className="actions pagination"><button className="button small secondary" disabled={page === 0} onClick={() => setPage(value => value - 1)}><ArrowLeft size={16} /> Previous</button><span>Page {page + 1} of {Math.ceil(data.count / 12)}</span><button className="button small secondary" disabled={(page + 1) * 12 >= data.count} onClick={() => setPage(value => value + 1)}>Next <ArrowRight size={16} /></button></div>}
    </>}
  </section>;
}
