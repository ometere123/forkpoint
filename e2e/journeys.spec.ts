import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { abi } from 'genlayer-js';

const address = '0x1111111111111111111111111111111111111111';
const account = '0x2222222222222222222222222222222222222222';
const hash = '0x' + '3'.repeat(64);
const rpcUrl = 'https://studio.genlayer.com/api';
const market = {
  id: 0, feature: 'Adopt the event parser', cutoff: 1_900_000_010, trigger_deadline: 1_900_000_020,
  outcome_deadline: 1_900_000_040, trigger_repo_id: 15, pr_number: 12, target_repo_id: 17,
  release_tag: 'v4.0.0', criteria: [
    { path: 'src/parser.py', needle: 'def parse_event(payload):\n    return Event(payload)' },
    { path: 'docs/events.md', needle: 'Events use structured data.\nPayload fields are validated.' },
  ],
  stake: '1000000000000000', limit: 16, created_at: 1_900_000_000,
  yes_count: 0, no_count: 0, state: 'CREATED', merged_at: null,
  trigger_window_start: 1_900_000_021, trigger_window_end: 1_900_003_621,
  outcome_window_start: 1_900_003_621, outcome_window_end: 1_900_007_221,
  trigger_slot: 0, outcome_slot: 0, evidence: { trigger: [], outcome: [], expiration: null },
};
type RpcResponse = { status: string; execution?: string };
type Fixture = { count: number; receipt?: RpcResponse; sends: unknown[]; reads: string[]; position: boolean };

function encoded(value: string | number) {
  return Buffer.from(abi.calldata.encode(value)).toString('hex');
}

async function wire(page: Page, fixture: Fixture) {
  await page.route(rpcUrl, async route => {
    const { id, method, params } = route.request().postDataJSON() as {
      id: number; method: string; params: [{ data: string; to: string; transaction_hash_variant: string }];
    };
    let result: unknown;
    if (method === 'gen_call') {
      const bytes = Buffer.from(params[0].data.replace(/^0x/, ''), 'hex');
      expect(params[0].to.toLowerCase()).toBe(address);
      expect(params[0].transaction_hash_variant).toBe('latest-final');
      if (bytes.includes('market_count')) { fixture.reads.push('market_count'); result = encoded(fixture.count); }
      else if (bytes.includes('get_market')) { fixture.reads.push('get_market'); result = encoded(JSON.stringify(market)); }
      else if (bytes.includes('get_position')) {
        fixture.reads.push('get_position');
        result = encoded(JSON.stringify(fixture.position ? { yes: true, stake: market.stake, dispatched: false, claimable: '0' } : null));
      }
    } else if (method === 'eth_getTransactionByHash') {
      result = fixture.receipt ? {
        hash, status: fixture.receipt.status, from_address: account, to_address: address, value: market.stake,
        data: { calldata: Buffer.from(abi.calldata.encode(abi.calldata.makeCalldataObject("predict", [0, true], undefined))).toString("base64") },
        consensus_data: { leader_receipt: { execution_result: fixture.receipt.execution } },
        triggered_transactions: [],
      } : null;
    } else if (method === 'eth_estimateGas') result = '0x10000';
    else if (method === 'eth_chainId') result = '0xf22f';
    else if (method === 'eth_getTransactionCount') result = '0x0';
    else if (method === 'eth_gasPrice') result = '0x1';
    await route.fulfill({ json: {
      jsonrpc: '2.0', id,
      ...(result === undefined ? { error: { code: -32601, message: `No fixture for ${method}` } } : { result }),
    } });
  });
}

async function wallet(page: Page, fixture: Fixture) {
  await page.exposeBinding('recordForkpointSend', (_source, params: unknown) => {
    fixture.sends.push(params);
    return hash;
  });
  await page.addInitScript(({ account }) => {
    let connected = sessionStorage.getItem('fixture-connected') === 'yes';
    let network = sessionStorage.getItem('fixture-chain') || '0x1';
    const events = new Map<string, Set<(...args: unknown[]) => void>>();
    const browser = window as unknown as {
      ethereum: { request(args: { method: string; params?: unknown }): Promise<unknown>; on(event: string, listener: () => void): void; removeListener(event: string, listener: () => void): void };
      recordForkpointSend(params: unknown): Promise<string>;
    };
    browser.ethereum = {
      async request({ method, params }) {
        if (method === 'eth_accounts') return connected ? [account] : [];
        if (method === 'eth_requestAccounts') { connected = true; sessionStorage.setItem('fixture-connected', 'yes'); return [account]; }
        if (method === 'eth_chainId') return network;
        if (method === 'wallet_switchEthereumChain') {
          network = (params as [{ chainId: string }])[0].chainId;
          sessionStorage.setItem('fixture-chain', network);
          events.get('chainChanged')?.forEach(listener => listener(network));
          return null;
        }
        if (method === 'eth_estimateGas') return '0x10000';
        if (method === 'eth_sendTransaction') return browser.recordForkpointSend(params);
        throw new Error(`No wallet fixture for ${method}`);
      },
      on(event, listener) { if (!events.has(event)) events.set(event, new Set()); events.get(event)?.add(listener); },
      removeListener(event, listener) { events.get(event)?.delete(listener); },
    };
  }, { account });
}

function fresh(): Fixture { return { count: 1, sends: [], reads: [], position: false }; }

test('keyboard navigation, responsive layout and accessible explorer with RPC fixtures', async ({ page }) => {
  const fixture = fresh();
  await wire(page, fixture);
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.getByRole('navigation').getByRole('link', { name: 'Markets' }).click();
  await expect(page.getByRole('link', { name: market.feature })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search this page' }).fill('missing search');
  await expect(page.getByText('No matching markets on this page.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search this page' }).fill('parser');
  await page.getByRole('link', { name: market.feature }).click();
  await expect(page.getByRole('heading', { name: 'Locked conditions' })).toBeVisible();
  await expect(page.getByText('No settlement evidence recorded yet.')).toBeVisible();
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasOverflow).toBe(false);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
});

test('wallet gating, payable submission, refresh recovery, execution success and final readback with fixtures', async ({ page }) => {
  const fixture = fresh();
  await wire(page, fixture);
  await wallet(page, fixture);
  await page.goto('/markets/0');
  await expect(page.getByRole('heading', { name: market.feature })).toBeVisible();
  await page.getByRole('button', { name: 'Connect wallet' }).first().click();
  await expect(page.getByText('Wrong network.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Predict YES' })).toBeDisabled();
  expect(fixture.sends).toHaveLength(0);
  await page.getByRole('button', { name: 'Switch to Studionet' }).first().click();
  await page.getByRole('button', { name: 'Predict YES' }).click();
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  await expect.poll(() => fixture.sends.length).toBe(1);
  const [transaction] = fixture.sends[0] as [{ to: string; data: string; chainId: string; value: string; gas: string }];
  expect(transaction.chainId).toBe('0xf22f');
  expect(BigInt(transaction.value)).toBe(BigInt(market.stake));
  expect(BigInt(transaction.gas)).toBeGreaterThan(0n);
  expect(Buffer.from(transaction.data.slice(2), 'hex').includes('predict')).toBe(true);

  fixture.receipt = { status: 'FINALIZED' };
  await page.reload();
  await expect(page.getByText('Finalized · Execution unverified', { exact: true })).toBeVisible();
  expect(fixture.sends).toHaveLength(1);
  fixture.position = true;
  fixture.receipt.execution = 'SUCCESS';
  await expect(page.getByText('Finalized · Success', { exact: true })).toBeVisible();
  await expect(page.getByText('Your position · YES', { exact: true })).toBeVisible();
  expect(fixture.reads).toContain('get_position');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet' }).first()).toBeVisible();
});


test('validates public GitHub IDs and freezes an exact source marker in the creation preview', async ({ page }) => {
  const fixture = fresh();
  await wire(page, fixture);
  await page.route('https://api.github.com/repositories/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const result = path.endsWith('/pulls/12')
      ? { number: 12, merged_at: null, base: { repo: { id: 15 } } }
      : path.endsWith('/15') ? { id: 15, private: false, full_name: 'test/trigger' }
      : { id: 17, private: false, full_name: 'test/target' };
    await route.fulfill({ json: result });
  });
  await page.goto('/markets/new');
  await page.getByLabel('Trigger repository ID').fill('15');
  await page.getByLabel('Pull request number').fill('12');
  await page.getByLabel('Target repository ID').fill('17');
  await page.getByLabel('Immutable release tag').fill('v4.0.0');
  await page.getByLabel('Feature description').fill(market.feature);
  for (const [index, criterion] of market.criteria.entries()) {
    await page.getByLabel('Repository path').nth(index).fill(criterion.path);
    await page.getByLabel('Required multiline source').nth(index).fill(criterion.needle);
  }
  await page.getByLabel('Prediction cutoff (UTC)').fill('2030-03-01T10:00');
  await page.getByLabel('Trigger deadline (UTC)').fill('2030-03-01T11:00');
  await page.getByLabel('Outcome deadline (UTC)').fill('2030-03-01T12:00');
  await page.getByLabel('Fixed stake (GEN)').fill('0.001');
  // The application limits the horizon, so give this fixture a pinned UI clock.
  await page.clock.setFixedTime(new Date('2030-02-01T00:00:00.000Z'));
  await page.getByRole('button', { name: 'Review market' }).click();
  await expect(page.getByRole('heading', { name: 'Review immutable terms' })).toBeVisible();
  await expect(page.getByText('test/target', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create market', exact: true })).toBeDisabled();
  expect(fixture.sends).toHaveLength(0);
});

test('finalized execution error does not create a position with RPC fixtures', async ({ page }) => {
  const fixture = fresh();
  await wire(page, fixture);
  await wallet(page, fixture);
  await page.goto('/markets/0');
  await expect(page.getByRole('heading', { name: market.feature })).toBeVisible();
  await page.getByRole('button', { name: 'Connect wallet' }).first().click();
  await page.getByRole('button', { name: 'Switch to Studionet' }).first().click();
  await page.getByRole('button', { name: 'Predict YES' }).click();
  await page.getByRole('button', { name: 'Continue to wallet' }).click();
  await expect.poll(() => fixture.sends.length).toBe(1);
  fixture.receipt = { status: 'FINALIZED', execution: 'ERROR' };
  await expect(page.getByText('Execution failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Your position · YES', { exact: true })).toHaveCount(0);
  expect(fixture.sends).toHaveLength(1);
});
