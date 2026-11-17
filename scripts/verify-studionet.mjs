import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const network = 61999;
const endpoint = 'https://studio.genlayer.com/api';
const address = process.argv[2];
const methods = [
  'create_market', 'predict', 'check_trigger', 'check_outcome', 'expire',
  'claim', 'get_market', 'market_count', 'get_position', 'get_treasury',
];

async function rpc(method, params = []) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error || body.result === undefined) {
    throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  }
  return body.result;
}

if (Number(await rpc('eth_chainId')) !== network) throw new Error('Unexpected chain');
if (address === undefined) {
  console.log(JSON.stringify({ network, endpoint }));
} else {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid contract address');
  const [encoded, schema, local] = await Promise.all([
    rpc('gen_getContractCode', [address]),
    rpc('gen_getContractSchema', [address]),
    readFile(new URL('../build/forkpoint.py', import.meta.url)),
  ]);
  const remote = Buffer.from(encoded, 'base64');
  if (!local.equals(remote)) throw new Error('Deployed source differs from local build');
  const contractMethods = schema.methods ?? schema;
  for (const method of methods) {
    if (!Object.hasOwn(contractMethods, method)) throw new Error(`Missing deployed method ${method}`);
  }
  console.log(JSON.stringify({
    network, endpoint, address,
    sourceSha256: createHash('sha256').update(local).digest('hex'),
    exactBytes: true, schema,
  }, null, 2));
}
