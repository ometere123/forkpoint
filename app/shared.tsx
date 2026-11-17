'use client';

import { useState } from 'react';
import { ADDRESS, CHAIN, errorMessage, formatGen, transactionLink } from '../lib/chain';
import { useWallet } from './wallet';

const labels: Record<string, string> = {
  CREATED: 'Open for predictions', PREDICTIONS_CLOSED: 'Predictions closed', TRIGGER_CHECK: 'Trigger check',
  ACTIVE: 'Trigger verified', OUTCOME_CHECK: 'Outcome check', VOID: 'Void · Refundable',
  INCONCLUSIVE: 'Inconclusive · Refundable', RESOLVED_YES: 'Resolved YES', RESOLVED_NO: 'Resolved NO',
};
export const statusLabel = (state: string) => labels[state] ?? state;
export const dateLabel = (seconds: number) => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
}).format(seconds * 1000);
export const marketUrl = (id: number) => `/markets/${id}`;
export const repoUrl = (id: number) => `https://api.github.com/repositories/${id}`;
export function Status({ state }: { state: string }) {
  return <span className={`badge ${state === 'CREATED' || state === 'RESOLVED_YES' ? 'good' : ''}`}>{statusLabel(state)}</span>;
}
export function Availability() {
  return ADDRESS ? null : <div className="callout"><strong>Studionet contract unavailable</strong><p>Live markets and wallet writes will be available when a FORKPOINT deployment is configured.</p></div>;
}
export function WalletGate() {
  const { account, chain } = useWallet();
  if (!account) return <p className="muted">Connect your wallet to continue.</p>;
  if (chain !== CHAIN) return <p className="muted">Switch to Studionet 61999 to sign.</p>;
  return null;
}

const actions: Record<string, string> = {
  create_market: 'Create market', predict: 'Place prediction', check_trigger: 'Check trigger',
  check_outcome: 'Check outcome', expire: 'Expire market', claim: 'Claim payout',
};
export function History({ market, creation = false }: { market?: number; creation?: boolean }) {
  const { entries, account, recover, busy, refreshReceipts } = useWallet();
  const [recoveryError, setRecoveryError] = useState('');
  const matching = entries.filter(entry => {
    const [method, id] = entry.key.split(':');
    return entry.account.toLowerCase() === account?.toLowerCase()
      && (!creation || method === 'create_market') && (market === undefined || id === String(market));
  }).sort((a, b) => b.date - a.date);
  return <div className="history">
    {matching.length === 0 ? <p className="muted">No transactions recorded in this browser for this view.</p> : <ol>
      {matching.map(entry => {
        const [method, id] = entry.key.split(':');
        return <li key={`${entry.date}:${entry.key}`}>
          <div><strong>{actions[method] ?? method}{id && ` · Market #${id}`}</strong><small>{dateLabel(entry.date / 1000)}</small></div>
          <div><span aria-live="polite" className="badge">{entry.phase}</span>{entry.estimatedFee && <small>Estimated network fee {formatGen(entry.estimatedFee)}</small>}
            {entry.hash && <a href={transactionLink(entry.hash)} target="_blank" rel="noreferrer">Transaction ↗</a>}
            {entry.children?.map(hash => <a key={hash} href={transactionLink(hash)} target="_blank" rel="noreferrer">Child receipt {hash.slice(0, 8)} ↗</a>)}
            {method === 'claim' && entry.phase === 'Finalized · Success' && <small>{entry.delivery ?? 'Claim finalized. Transfer delivery is being checked.'}</small>}
            {method === 'predict' && entry.phase === 'Application rejected · refund dispatched' && <small>{entry.delivery ?? 'Refund dispatched. Recipient credit is being checked.'}</small>}
            {method === 'predict' && entry.phase === 'Application rejected · no refund required' && <small>No value was attached, so no refund transfer was required.</small>}
            {!entry.hash && !busy && entry.phase !== 'Execution failed' && <details><summary>Recover submission</summary>
              <p>Check the wallet’s Studionet activity. Attach the hash if it submitted a transaction. Clear this record only after confirming no transaction was sent.</p>
              <form onSubmit={event => {
                event.preventDefault();
                const hash = new FormData(event.currentTarget).get('hash');
                try { setRecoveryError(''); recover(entry, String(hash).trim()); } catch (error) { setRecoveryError(errorMessage(error)); }
              }}>
                <label>Transaction hash<input name="hash" required /></label>
                <button className="button small secondary" type="submit">Track transaction</button>
              </form>
              <button type="button" className="button small plain" onClick={() => {
                if (window.confirm('I checked my wallet and confirmed it sent no transaction.')) recover(entry, '');
              }}>Clear unsent write</button>
              {recoveryError && <small role="alert">{recoveryError}</small>}
            </details>}
          </div>
        </li>;
      })}
    </ol>}
    {matching.some(entry => entry.hash) && <button type="button" className="button small plain" onClick={refreshReceipts}>Refresh receipts</button>}
  </div>;
}
export { errorMessage };



