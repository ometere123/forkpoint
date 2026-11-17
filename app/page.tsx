import Link from 'next/link';
import { ArrowRight, ArrowUpRight, GitMerge, PackageCheck, GitFork, Scale } from 'lucide-react';

export default function Home() {
  return <>
    <section className="hero"><div className="wrap hero-grid">
      <div className="hero-copy">
        <p className="eyebrow"><span className="signal" /> Conditional prediction markets</p>
        <h1>What happens <em>after</em> the merge?</h1>
        <p className="lede">Take a position on how one open-source project responds to another. The first GitHub event unlocks the prediction. GenLayer checks the result.</p>
        <div className="actions">
          <Link className="button primary" href="/markets">Explore markets <ArrowRight size={18} /></Link>
          <Link className="button secondary" href="/markets/new">Create a market <ArrowUpRight size={17} /></Link>
        </div>
      </div>
      <figure className="diagram" aria-label="Example market, illustrating a merge followed by a release">
        <figcaption><span className="figure-dot" /> How a conditional market works</figcaption>
        <div className="stage"><div className="tile-icon tan"><GitMerge size={23} /></div><div><span className="eyebrow">Trigger</span><h2>A pull request merges</h2><p>The merge must land within the market’s window.</p></div></div>
        <div className="rail"><span /> <p>Only if the trigger qualifies</p></div>
        <div className="stage"><div className="tile-icon pale"><PackageCheck size={24} /></div><div><span className="eyebrow">Outcome</span><h2>A release contains the required source</h2><p>Validators check the tagged source against the frozen criteria.</p></div></div>
        <div className="branches"><span>YES <small>Criteria met</small></span><span>NO <small>Criteria unmet</small></span></div>
      </figure>
    </div></section>
    <section className="wrap steps" aria-labelledby="rules">
      <div className="steps-head"><p className="eyebrow">Market rules</p><h2 id="rules">Two events. One prediction.</h2></div>
      <div className="step-grid">
        <article><GitFork /><h3>Lock the conditions</h3><p>Choose the pull request, target release, deadlines and exact source criteria before the first stake.</p></article>
        <article><PackageCheck /><h3>Verify on GitHub</h3><p>GenLayer validators independently check the merge and the immutable release against the market terms.</p></article>
        <article><Scale /><h3>Claim a payout</h3><p>The winning side shares the pool. Voided or inconclusive markets are refundable.</p></article>
      </div>
    </section>
  </>;
}
