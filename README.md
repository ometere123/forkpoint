# FORKPOINT

Fund a YES or NO position on whether a named public GitHub release contains specified source changes after another repository merges a pull request. FORKPOINT uses Studionet test GEN and a GenLayer Intelligent Contract for market state, settlement and payouts.

## Local setup

Install Node.js 22, Python 3.12 and uv. The same commands work in Windows PowerShell and on Ubuntu.

```sh
uv sync --locked
npm ci
uv run python scripts/build_contract.py
npm run genlayer -- --version
npm run dev
```

Set `NEXT_PUBLIC_FORKPOINT_CONTRACT` to the verified replacement address from Studionet (`0x2702C583b4d331f299B2f5988A9DeB476610f221`). The app uses chain 61999 and `https://studio.genlayer.com/api`. Connect an injected EIP-1193 wallet to submit transactions. Public market reads use the configured Studionet RPC.

The light editorial interface takes structural cues from the recent [Civic Press](https://www.framer.com/marketplace/templates/civic-press/) and [Kestrel Finance](https://www.framer.com/marketplace/templates/kestrel-finance/) Framer previews. FORKPOINT uses original layout, copy, CSS, icons and no template assets.

## Market rules

The market creator freezes the numeric public repository IDs, trigger PR number, exact target release tag, feature description, two to four source criteria, three UTC deadlines, fixed stake and participant cap. The feature description is for participants. The settlement predicate is the exact list of source markers that participants see before signing. The policy requires distinct contiguous, multiline markers in the agreed regular UTF-8 files.

For Python criteria, the evidence verifier requires a parseable and compilable module, ignores constant-dead branches and statements after an unconditional terminator, and accepts only a complete substantive statement block. This is bounded static source evidence; it is not a proof of runtime execution, compatibility, or general semantic correctness.

One direct wallet gets one position with the exact stake, before the cutoff. Eligible trigger merges occur after market creation, at or after the prediction cutoff and at or before the trigger deadline. A definitive failed trigger voids the market. An eligible trigger activates outcome verification. The named immutable release must have been published after the merge and at or before the outcome deadline. GitHub metadata and Git objects support the source claim. The contract checks what the specified source files contain. It makes no runtime compatibility guarantee.

Trigger checks open one second after the trigger deadline. Outcome checks open one second after the outcome deadline or after the trigger window ends, whichever is later. Each phase has two fixed 30-minute slots. The contract records at most one accepted decision per slot. Definitive decisions are terminal for the stage. A second inconclusive decision enables refunds. If a stage expires without a decision, any wallet can call `expire` to enable refunds. Consensus failures that leave state unchanged are bounded by the same window.

GitHub is the evidence authority. Validators fetch the allowed GitHub endpoints independently and compare the complete canonical decision facts. Unverifiable evidence becomes inconclusive. Public metadata can be unavailable, rate-limited or deleted. A missing release cannot establish a historical negative. The frozen immutable release and its verified source determine a positive or negative result under the source predicate. Repository owners can influence real-world events and can trade if they control an otherwise eligible wallet.

## Accounting

The pool is the number of accepted positions times the stake. Winning wallets split the full pool in integer wei. The earliest accepted winning position receives the entire remainder. A zero-winner outcome, a void market or a terminal inconclusive result refunds each original stake. Claims close each entitlement individually with no administrator withdrawal.

A successful claim records `EMITTED_UNCONFIRMED` and emits a native transfer to the claimant. The claim transaction's finality and execution success certify the dispatch. A recipient-credit receipt is separate evidence. The contract cannot safely retry a failed or ambiguous payout or guarantee automatic recovery. The treasury read divides deposits into dispatched and undispatched wei and exposes the runtime balance independently.

## Verification

```sh
uv run python scripts/build_contract.py
uv run python -m pytest --cov=build --cov-branch --cov-report=term-missing
uv run python scripts/mutate_contract.py
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npx playwright test
node scripts/mutate_frontend.mjs
node scripts/verify-studionet.mjs
node scripts/verify-studionet.mjs CONTRACT_ADDRESS
```

For GenVM lint, set `GENVM_VERSION=v0.2.16` and `PYTHONUTF8=1` in your shell, then run `uv run genvm-lint check build/forkpoint.py`. The assembler emits UTF-8 with LF line endings so the exact deployed bytes can be reproduced on either OS. The Studionet verifier compares those bytes and the live schema with the local build.

## Studionet candidate deployment

The validated candidate is deployed at [`0x99F02B4f47C03aDDFaaC3a14925B5137d08926a3`](https://explorer-studio.genlayer.com/address/0x99F02B4f47C03aDDFaaC3a14925B5137d08926a3) on chain 61999. Its finalized deployment transaction is [`0x72b9e1ab9ae4a38fe0dea14913e61ca62def8b793438072a1b72d7ccb769b080`](https://explorer-studio.genlayer.com/tx/0x72b9e1ab9ae4a38fe0dea14913e61ca62def8b793438072a1b72d7ccb769b080). The exact source SHA-256 is `2d67bc6b5e69a96f956d18ac6ff02570b6e529ed01cd85ab4d7664927e028051`; see `deployments/studionet-candidate.json`. This is a candidate deployment, not a funded production release: no live market stake, payout or recipient-credit evidence is claimed.

For a funded acceptance run, start with a controlled public trigger PR and unpublished target tag on an immutable-release-enabled repository. Create and fund the market from distinct test wallets before the cutoff, then merge the trigger in its eligible interval. Publish the immutable target release after the merge. Verify finalized successful settlement and claim transactions, market and treasury readbacks, and native recipient-credit evidence. Use a separate unmerged PR through the deadline to verify the refund path.

## Studionet replacement deployment

The source-hardened replacement is deployed at [`0x2702C583b4d331f299B2f5988A9DeB476610f221`](https://explorer-studio.genlayer.com/address/0x2702C583b4d331f299B2f5988A9DeB476610f221) on chain 61999. Its finalized deployment transaction is [`0xcf0fcedbc06320509560f10a7a01178a831e8bedc3d286e193fa8f227db0b87e`](https://explorer-studio.genlayer.com/tx/0xcf0fcedbc06320509560f10a7a01178a831e8bedc3d286e193fa8f227db0b87e). `scripts/verify-studionet.mjs` reports exact byte parity with source SHA-256 `04b5112f2624699562f680627f1d8c56fddeae8ac4d42de7f69ff493405af8dd` and the expected ten-method schema; see `deployments/studionet-replacement.json`.

This is an experimental Studionet deployment, not an unrestricted production release. The contract now handles validation refusals as tagged successful calls that emit the exact incoming value back to the direct sender, avoiding the known raise-after-credit path. That message is still `EMITTED_UNCONFIRMED`: only a finalized child SEND and an independent recipient balance readback establish delivery. On this replacement, exact stake, wrong stake, duplicate position, late position, VOID settlement and claim were exercised with disposable GEN; every tested refund child finalized with `value_credited=true`, both wallet balances returned to their faucet baselines, and the final treasury/runtime balance was zero. The full controlled YES, NO and INCONCLUSIVE two-slot lifecycles remain unverified, and native transfers are not atomic at the protocol boundary. The current classification is `PUBLIC_TESTNET_BETA`; unrestricted production-grade release remains blocked by those disclosed limitations.

Controlled public fixtures used for the attempted live acceptance run are [`forkpoint-trigger-fixture`](https://github.com/ometere123/forkpoint-trigger-fixture) and [`forkpoint-target-fixture`](https://github.com/ometere123/forkpoint-target-fixture). The target repository has immutable releases enabled. No YES, NO, or INCONCLUSIVE lifecycle is claimed here; the funded evidence retained in [`deployments/studionet-replacement-funded-evidence.json`](deployments/studionet-replacement-funded-evidence.json) is a boundary plus VOID smoke, not a completed three-outcome release certification.



## Funded release gate

The published stable GenVM v0.2.16 HTTP bridge follows redirects and exposes no final URL or redirect-control option to the Python contract. The verifier constructs only fixed numeric GitHub API paths and rejects visible redirects. Its size check runs after GenVM buffers the response. A validator-side transport that refuses redirects or proves the effective origin and enforces a response bound is necessary to meet the frozen evidence policy. See the [HTTP client](https://github.com/genlayerlabs/genvm/blob/v0.2.16/modules/implementation/src/common/mod.rs#L535-L541) and [response handling](https://github.com/genlayerlabs/genvm/blob/v0.2.16/modules/implementation/src/scripting/mod.rs#L228-L246).

Before enabling funds, verify on Studionet that rejected payable transactions do not lose value, including wrong stake, duplicate participation and late submission. Verify both a successful credit and a failed native transfer boundary. Direct Mode tests use the official SDK harness with recorded HTTP inputs and cannot establish those ledger effects. Browser tests use isolated RPC and EIP-1193 fixtures and cannot certify a live deployment.

The historical-candidate boundary evidence is retained in the release notes and transaction records: valid prediction `0x978c54afcc464c9dff68e2ef9f62a4a3ef9334eb9a05fac22a223c988ccaed04`; wrong stake `0x9167774587f684d0b31f202aae0fc699e8572e51c1a85f41120171314b51e7a9`; duplicate `0x7f90c69ebf9a8c45e98cb6503743d89a42a8b8941c7852bd6e3089c96181663b`; late `0x2d4a573a020dd943dabc6adb0661ea2c38dcbe0ef6889572e97e23121220debb`; VOID settlement `0x1bf7dd669de8bc837b886f510677814b32e9c193737ae14a12a7ecb5902160ae`; refund claim `0x609020a0786f2c97f10f48207b0dbd50e4918d5f52911a7b492778b778491520`; and recipient SEND `0xf97d3c6e41917a160f0f58ac8c3aa6224cb8bf3b4271e0a5f002b899102f9278`.

The replacement boundary smoke is reproducible from [`deployments/studionet-replacement-funded-evidence.json`](deployments/studionet-replacement-funded-evidence.json): creation `0xd7f617771331d2ad1b20d149459f920f41c1cbeed4ed302fed172a6f5a7f5f01`, exact stake `0x68d3dcdb57826510c17082d78bfa6c2ccf2b507de34845f72bc60c6f739f961d`, wrong stake/refund `0x1069d85599fcafe3df075df78057e0a9a4a9157bef4684ecc43264b0c8c400d7` → `0x5221b1d73e1614de6fab43e1884280df15cb6b9783d75fe52be116519cff1f0c`, duplicate/refund `0x1ad9cbe24bdd34ef849059fb3d5224def1a96a75e52193548f6fb937a90c77d5` → `0xf7bb5bbe84e5a861f548c090c6893d4daa81a8580d580c9e74513aa41ba1addb`, late/refund `0x13f65df63875f8270cbbf5cdecf4d85f09606d129e5f86ae69b545619e176f68` → `0xba0ee2c47a0ce117e31de8098c64cf5bf5eb5d52594caee6e0ba46f5570ffad0`, VOID settlement `0x7c03b3a60b1266afae10b6b3d089eec37fa1e37dda44f297350234be13c0aa19`, claim `0x3267dd0c03acc0dd73ede8ecb9c1364b49635a7769ec4fc99e39676794dc2d3a` → `0x1d0c67e70013b8ffa094ebbfb1cc9153590d27b174b449f6a63c8809016084a7`, and repeat-claim rejection `0x4299714fa20be6cb0a05667af13ba77f780f6f3850c582c311fc0d5374610dd8`.
