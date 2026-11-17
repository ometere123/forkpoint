'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, GitMerge, PackageCheck } from 'lucide-react';
import { ADDRESS, CHAIN, errorMessage, formatGen, type MarketSpec } from '../../../lib/chain';
import { useWallet } from '../../wallet';
import { Availability, dateLabel, History, WalletGate } from '../../shared';

function field(data: FormData, name: string) {
  const value = data.get(name);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Complete the ${name.replaceAll('_', ' ')} field.`);
  return value.trim();
}
function sourceField(data: FormData, name: string) {
  const value = data.get(name);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Complete the ${name.replaceAll('_', ' ')} field.`);
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}
function integer(data: FormData, name: string) {
  const value = Number(field(data, name));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name.replaceAll('_', ' ')} must be a positive integer.`);
  return value;
}
function isImplementationPath(path: string) {
  if (!path.endsWith('.py')) return false;
  const parts = path.toLowerCase().split('/');
  const filename = parts.pop() ?? '';
  const fixtureDirectories = new Set(['test', 'tests', 'fixture', 'fixtures', '__tests__', '__fixtures__']);
  return !parts.some(part => fixtureDirectories.has(part))
    && !/^(?:conftest|tests?|fixtures?)\.py$|^(?:test_|fixture_)|(?:_test|_fixture)\.py$/.test(filename);
}
function printable(value: string, allowLines = false) {
  return !/[\p{Other}\p{Separator}]/u.test(value.replaceAll(' ', '').replace(allowLines ? /[\n\t]/g : /$^/, ''));
}
function parseSpec(data: FormData, count: number): MarketSpec {
  const criteria = Array.from({ length: count }, (_, i) => {
    const path = field(data, `path_${i}`);
    const needle = sourceField(data, `needle_${i}`);
    if (!/^[a-z\d._-]+(?:\/[a-z\d._-]+)*$/i.test(path) || path.split('/').some(s => s === '.' || s === '..') || path.length > 160) {
      throw new Error(`Criterion ${i + 1} has an invalid repository path.`);
    }
    const bytes = new TextEncoder().encode(needle).length;
    if ([...needle].length < 20 || bytes > 240 || !printable(needle, true) || needle.startsWith('\n') || needle.endsWith('\n') || new Set(needle.split('\n').map(line => line.trim()).filter(Boolean)).size < 2) throw new Error(`Criterion ${i + 1} needs two or more non-empty lines and 20–240 UTF-8 bytes.`);
    return { path, needle };
  });
  if (!criteria.some(criterion => isImplementationPath(criterion.path))) throw new Error('Add at least one Python implementation criterion outside test or fixture paths.');
  if (new Set(criteria.map(item => JSON.stringify(item))).size !== criteria.length) throw new Error('Use distinct source criteria.');
  const feature = field(data, 'feature');
  if ([...feature].length < 8 || [...feature].length > 400 || new TextEncoder().encode(feature).length > 640 || !printable(feature)) {
    throw new Error('Enter a single-line feature description between 8 and 400 characters (640 UTF-8 bytes maximum).');
  }
  const release_tag = field(data, 'release_tag');
  if (!/^[a-z\d_-](?:[a-z\d._-]{0,78}[a-z\d_-])?$/i.test(release_tag) || release_tag.includes('..') || release_tag.endsWith('.lock')) throw new Error('Enter a safe GitHub release tag.');
  const cutoff = Date.parse(field(data, 'cutoff') + 'Z') / 1000;
  const trigger_deadline = Date.parse(field(data, 'trigger_deadline') + 'Z') / 1000;
  const outcome_deadline = Date.parse(field(data, 'outcome_deadline') + 'Z') / 1000;
  if (![cutoff, trigger_deadline, outcome_deadline].every(Number.isSafeInteger)
    || cutoff > trigger_deadline || trigger_deadline >= outcome_deadline) throw new Error('Order the deadlines as cutoff, trigger, then outcome.');
    const now = Math.floor(Date.now() / 1000);
  if (cutoff <= now || outcome_deadline > now + 366 * 86400) throw new Error('Set future dates within 366 days. Studionet validates the final cutoff.');
  const input = field(data, 'stake');
  if (!/^\d{1,24}(?:\.\d{1,18})?$/.test(input)) throw new Error('Enter a GEN amount with up to 18 decimal places.');
  const [whole, fraction = ''] = input.split('.');
  const stake = BigInt(whole + fraction.padEnd(18, '0'));
  const limit = integer(data, 'limit');
  if (stake === 0n || stake > 10n ** 24n || limit < 2 || limit > 64) throw new Error('Enter a positive stake and a limit between 2 and 64.');
  return { trigger_repo_id: integer(data, 'trigger_repo_id'), pr_number: integer(data, 'pr_number'), target_repo_id: integer(data, 'target_repo_id'),
    feature, cutoff, trigger_deadline, outcome_deadline, release_tag, criteria, limit, stake: stake.toString() };
}
async function github(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(`GitHub could not verify this rule (HTTP ${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GitHub response unavailable.');
  const decoder = new TextDecoder();
  let count = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    count += value.byteLength;
    if (count > 524_288) { await reader.cancel(); throw new Error('GitHub response exceeded the preview limit.'); }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode()) as Record<string, unknown>;
}

export function CreateMarket() {
  const [count, setCount] = useState(2);
  const [preview, setPreview] = useState<{ spec: MarketSpec; trigger: string; target: string }>();
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { account, chain, busy, submit } = useWallet();
  const review = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(''); setPreview(undefined); setValidating(true);
    try {
      const spec = parseSpec(new FormData(event.currentTarget), count);
      const [trigger, target, pull] = await Promise.all([
        github(`/repositories/${spec.trigger_repo_id}`), github(`/repositories/${spec.target_repo_id}`),
        github(`/repositories/${spec.trigger_repo_id}/pulls/${spec.pr_number}`),
      ]);
      if (trigger.id !== spec.trigger_repo_id || target.id !== spec.target_repo_id || trigger.private !== false || target.private !== false
        || typeof trigger.full_name !== 'string' || typeof target.full_name !== 'string') throw new Error('The public repository IDs did not match.');
      if (pull.number !== spec.pr_number || (pull.base as { repo?: { id?: number } } | undefined)?.repo?.id !== spec.trigger_repo_id) throw new Error('The pull request does not belong to the trigger repository.');
      if (pull.merged_at) throw new Error('This pull request has already merged. Choose an upcoming trigger.');
      setPreview({ spec, trigger: trigger.full_name, target: target.full_name });
    } catch (error) {
      setError(errorMessage(error));
    } finally { setValidating(false); }
  };
  const create = async () => {
    if (!preview) return;
    setError('');
    try { await submit({ method: 'create_market', args: [JSON.stringify(preview.spec)] }); setSubmitted(true); }
    catch (reason) { setError(errorMessage(reason)); }
  };
  return <section className="wrap page narrow">
    <Link href="/markets" className="back"><ArrowLeft size={15} /> Back to markets</Link>
    <div className="page-head"><div><p className="eyebrow">Market rules</p><h1>Create a market</h1><p className="lede">Frame a future GitHub event and lock the terms before anyone enters.</p></div></div>
    <Availability />
    <form onSubmit={review} onChange={() => { setPreview(undefined); setSubmitted(false); }}>
      <fieldset className="panel" disabled={validating}><legend><GitMerge size={18} /> Trigger</legend>
        <div className="form-grid">
          <label>Trigger repository ID<input required name="trigger_repo_id" inputMode="numeric" pattern="[0-9]+" /></label>
          <label>Pull request number<input required name="pr_number" inputMode="numeric" pattern="[0-9]+" /></label>
        </div>
        <p className="muted">Use the numeric ID from GitHub’s public repository API. The pull request must merge between cutoff and trigger deadline.</p>
      </fieldset>
      <fieldset className="panel" disabled={validating}><legend><PackageCheck size={18} /> Outcome</legend>
        <div className="form-grid">
          <label>Target repository ID<input required name="target_repo_id" inputMode="numeric" pattern="[0-9]+" /></label>
          <label>Immutable release tag<input required name="release_tag" maxLength={80} placeholder="v1.2.0" /></label>
        </div>
        <label>Feature description<input required name="feature" minLength={8} maxLength={400} placeholder="Describe the adoption this market tests." /></label>
        <p className="muted">Use at least one complete, multiline Python statement from an implementation path outside tests and fixtures. Every criterion requires exact source lines at the immutable release commit. Preserve spaces and indentation.</p>
        {Array.from({ length: count }, (_, i) => <div className="criteria" key={i}><h3>Criterion {i + 1}</h3>
          <label>Repository path<input required name={`path_${i}`} maxLength={160} placeholder="src/adoption.py" /></label>
          <label>Required multiline source<textarea required name={`needle_${i}`} maxLength={240} rows={3} /></label>
        </div>)}
        <div className="actions">
          {count < 4 && <button type="button" className="button small secondary" onClick={() => { setCount(count + 1); setPreview(undefined); }}>Add criterion</button>}
          {count > 2 && <button type="button" className="button small secondary" onClick={() => { setCount(count - 1); setPreview(undefined); }}>Remove last criterion</button>}
        </div>
      </fieldset>
      <fieldset className="panel" disabled={validating}><legend>Timing and stake</legend>
        <div className="form-grid">
          <label>Prediction cutoff (UTC)<input required name="cutoff" type="datetime-local" /></label>
          <label>Trigger deadline (UTC)<input required name="trigger_deadline" type="datetime-local" /></label>
          <label>Outcome deadline (UTC)<input required name="outcome_deadline" type="datetime-local" /></label>
          <label>Fixed stake (GEN)<input required name="stake" inputMode="decimal" placeholder="0.05" /></label>
          <label>Participant limit<input required name="limit" type="number" min={2} max={64} defaultValue={16} /></label>
        </div>
      </fieldset>
      <button className="button primary" disabled={validating}>{validating ? 'Checking GitHub…' : 'Review market'} <ArrowRight size={17} /></button>
    </form>
    {error && <p role="alert" className="callout alert">{error}</p>}
    {preview && <section className="panel" aria-labelledby="review"><h2 id="review">Review immutable terms</h2>
      <p><strong>If</strong> {preview.trigger} merges #{preview.spec.pr_number} by {dateLabel(preview.spec.trigger_deadline)}, <strong>then</strong> evaluate {preview.target} at {preview.spec.release_tag} by {dateLabel(preview.spec.outcome_deadline)}.</p>
      <p>{preview.spec.feature}</p>
      <p><strong>YES</strong> means every frozen criterion matches. <strong>NO</strong> requires authoritative negative evidence. A failed trigger or inconclusive evidence makes stakes refundable.</p>
      <p>Predictions close {dateLabel(preview.spec.cutoff)}. {formatGen(preview.spec.stake)} per wallet · {preview.spec.limit} participants.</p>
      <WalletGate />
      <button type="button" className="button primary" disabled={!ADDRESS || !account || chain !== CHAIN || busy || submitted} onClick={create}>Create market <ArrowRight size={16} /></button>
    </section>}
    <History creation />
  </section>;
}


