'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowLeft, ArrowUpRight, GitMerge, PackageCheck } from 'lucide-react';
import { ADDRESS, CHAIN, errorMessage, formatGen, getMarket, getPosition, marketCount, type Market, type Method, type Position } from '../../../lib/chain';
import { Availability, dateLabel, History, Status, WalletGate } from '../../shared';
import { useWallet } from '../../wallet';

function sourceLink(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.host === 'api.github.com' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function evidenceSources(value: unknown, depth = 0): string[] {
  if (!value || typeof value !== 'object' || depth >= 4) return [];
  if (Array.isArray(value)) return value.flatMap(item => evidenceSources(item, depth + 1));
  const item = value as Record<string, unknown>;
  const sources = Array.isArray(item.sources) ? item.sources.map(sourceLink).filter((url): url is string => !!url) : [];
  return [...sources, ...Object.values(item).flatMap(child => evidenceSources(child, depth + 1))];
}

export function Detail({ id }: { id: number }) {
  const { account, chain, busy, ready, revision, submit } = useWallet();
  const [market, setMarket] = useState<Market>();
  const [position, setPosition] = useState<Position | null>();
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [side, setSide] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ADDRESS) return;
    let stopped = false;
    setLoadError(''); setPosition(undefined);
    (async () => {
      const count = await marketCount();
      if (id >= count) throw new Error('This market has not been created.');
      const current = await getMarket(id);
      if (!stopped) setMarket(current);
      if (account) {
        const currentPosition = await getPosition(id, account);
        if (!stopped) setPosition(currentPosition);
      }
    })().catch(error => { if (!stopped) setLoadError(errorMessage(error)); });
    return () => { stopped = true; };
  }, [id, account, revision, refresh]);

  const transact = async (method: Method, prediction?: boolean) => {
    setActionError('');
    try {
      await submit({ method, args: [id, ...(prediction === undefined ? [] : [prediction])], market: id,
        value: prediction === undefined || !market ? 0n : BigInt(market.stake) });
      setSide(null);
    } catch (error) { setActionError(errorMessage(error)); }
  };
  const enabled = !!ADDRESS && !!account && chain === CHAIN && ready && !busy && !loadError;
  const evidence = market?.evidence;
  const sources = [...new Set(evidenceSources(evidence))];
  const settled = !!market && ['VOID', 'INCONCLUSIVE', 'RESOLVED_YES', 'RESOLVED_NO'].includes(market.state);
  const hasRoom = !!market && market.yes_count + market.no_count < market.limit;

  return <section className="wrap page">
    <Link href="/markets" className="back"><ArrowLeft size={15} /> Back to markets</Link>
    <div className="page-head"><div>
      <p className="eyebrow">Market #{id}</p>
      <h1>{market?.feature ?? 'Market details'}</h1>
      {market && <Status state={market.state} />}
    </div><button className="button small secondary" type="button" onClick={() => setRefresh(value => value + 1)} disabled={!ADDRESS}>Refresh</button></div>
    <Availability />
    {loadError && <p role="alert" className="callout alert">{loadError}</p>}
    {ADDRESS && !market && !loadError && <p role="status" className="callout">Loading market…</p>}
    {market && <div className="detail-grid">
      <div>
        <section className="panel condition" aria-labelledby="conditions"><h2 id="conditions">Locked conditions</h2>
          <div className="detail-stage"><span className="tile-icon tan"><GitMerge size={20} /></span><div><p className="eyebrow">If</p><h3>Pull request #{market.pr_number} merges</h3>
            <a href={`https://api.github.com/repositories/${market.trigger_repo_id}/pulls/${market.pr_number}`} target="_blank" rel="noreferrer">GitHub repository {market.trigger_repo_id} <ArrowUpRight size={13} /></a>
            <p>From {dateLabel(market.cutoff)} through {dateLabel(market.trigger_deadline)}.</p>
            {market.merged_at && <p>Qualifying merge recorded {dateLabel(market.merged_at)}.</p>}</div></div>
          <div className="detail-rail"><ArrowDown size={20} /></div>
          <div className="detail-stage"><span className="tile-icon pale"><PackageCheck size={20} /></span><div><p className="eyebrow">Then</p><h3>{market.release_tag} includes the required source</h3>
            <a href={`https://api.github.com/repositories/${market.target_repo_id}/releases/tags/${encodeURIComponent(market.release_tag)}`} target="_blank" rel="noreferrer">Target repository {market.target_repo_id} <ArrowUpRight size={13} /></a>
            <p>The immutable release must follow the merge and publish by {dateLabel(market.outcome_deadline)}.</p></div></div>
        </section>
        <section className="panel" aria-labelledby="criteria"><h2 id="criteria">Source criteria</h2>
          {market.policy && <p className="muted">Evaluation policy {market.policy}</p>}
          <ol className="criteria-list">{market.criteria.map((criterion, index) => <li key={index}><h3><code>{criterion.path}</code></h3><pre>{criterion.needle}</pre></li>)}</ol>
          <p>YES requires all frozen criteria. NO requires authoritative evidence of non-fulfilment. A failed trigger or inconclusive evidence makes stakes refundable.</p>
        </section>
        <section className="panel" aria-labelledby="evidence"><h2 id="evidence">Consensus evidence</h2>
          {evidence && (evidence.trigger.length || evidence.outcome.length || evidence.expiration) ? <>
            <p>Recorded by the contract under the frozen evaluation policy.</p>
            {[...evidence.trigger, ...evidence.outcome].map((record, index) => <p key={index}><strong>{record.facts.verdict.replaceAll('_', ' ')}</strong> · {record.facts.reason.replaceAll('_', ' ')} · {dateLabel(record.checked_at)}</p>)}
            {sources.length > 0 && <ul className="links">{sources.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">{new URL(url).pathname} <ArrowUpRight size={13} /></a></li>)}</ul>}
            <details><summary>Canonical record</summary><pre>{JSON.stringify(evidence, null, 2)}</pre></details>
          </> : <p className="muted">No settlement evidence recorded yet.</p>}
        </section>
        <section className="panel" aria-labelledby="receipts"><h2 id="receipts">Your transaction receipts</h2><History market={id} /></section>
      </div>
      <aside>
        <section className="panel trade" aria-labelledby="prediction">
          <h2 id="prediction">Prediction</h2>
          <dl className="metrics">
            <div><dt>Fixed stake</dt><dd>{formatGen(market.stake)}</dd></div>
            <div><dt>Total pool</dt><dd>{formatGen(BigInt(market.stake) * BigInt(market.yes_count + market.no_count))}</dd></div>
            <div><dt>Positions</dt><dd>{market.yes_count + market.no_count}/{market.limit}</dd></div>
          </dl>
          <div className="branches trade-branches"><span>YES <small>{market.yes_count}</small></span><span>NO <small>{market.no_count}</small></span></div>
          {!account && <WalletGate />}
          {account && position === undefined && !loadError && <p role="status">Loading your position…</p>}
          {position && <div className="position"><strong>Your position · {position.yes ? 'YES' : 'NO'}</strong>
            <p>{formatGen(position.stake)} locked stake</p>
            {position.dispatched ? <p>Payout dispatched. Recipient credit is unconfirmed.</p> : settled && <p>{formatGen(position.claimable)} claimable</p>}
          </div>}
          {market.state === 'CREATED' && hasRoom && !position && <>
            <div className="actions predict-actions"><button className="button yes" type="button" onClick={() => setSide(true)} disabled={!enabled || position !== null}>Predict YES</button>
              <button className="button no" type="button" onClick={() => setSide(false)} disabled={!enabled || position !== null}>Predict NO</button></div>
            {side !== null && <div className="confirm"><p>Confirm {side ? 'YES' : 'NO'} for {formatGen(market.stake)} on Studionet. Your wallet will show the estimated network fee.</p>
              <button className="button primary" type="button" disabled={!enabled} onClick={() => transact('predict', side)}>Continue to wallet</button>
              <button className="button plain" type="button" disabled={busy} onClick={() => setSide(null)}>Cancel</button>
            </div>}
          </>}
          {market.state === 'CREATED' && !hasRoom && <p>All positions are filled.</p>}
          {position && !position.dispatched && BigInt(position.claimable) > 0n && <button className="button primary" type="button" disabled={!enabled} onClick={() => transact('claim')}>Claim payout</button>}
          {actionError && <p className="callout alert" role="alert">{actionError}</p>}
        </section>
        <section className="panel" aria-labelledby="settlement"><h2 id="settlement">Settlement</h2>
          <p>Anyone can initiate the next eligible check. The contract enforces the settlement windows.</p>
          <dl className="metrics"><div><dt>Trigger window opens</dt><dd>{dateLabel(market.trigger_window_start)}</dd></div><div><dt>Outcome window opens</dt><dd>{dateLabel(market.outcome_window_start)}</dd></div></dl>
          {market.can_check_trigger && <button className="button secondary" disabled={!enabled} onClick={() => transact('check_trigger')}>Check trigger</button>}
          {market.can_check_outcome && <button className="button secondary" disabled={!enabled} onClick={() => transact('check_outcome')}>Check outcome</button>}
          {market.can_expire && <p className="muted">The evidence window ended. Submit expiry to make stakes refundable.</p>}
          {market.can_expire && <button className="button plain" disabled={!enabled} onClick={() => transact('expire')}>Expire unresolved market</button>}
          {!settled && !market.can_check_trigger && !market.can_check_outcome && !market.can_expire && <p className="muted">No settlement action is currently eligible. Refresh to check the next window.</p>}
          {settled && <Status state={market.state} />}
        </section>
      </aside>
    </div>}
  </section>;
}


