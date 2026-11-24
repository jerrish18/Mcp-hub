import assert from 'node:assert/strict';
import test from 'node:test';
import { handleVirtualMcpRequest } from './virtualSandbox';

async function calculate(expression: string) {
  const reply = await handleVirtualMcpRequest({
    jsonrpc: '2.0', method: 'tools/call',
    params: { name: 'calculate_expression', arguments: { expression } },
  });
  return reply.result as { isError: boolean; content: Array<{ text: string }> };
}

test('sandbox arithmetic honors precedence, grouping, decimals, and unary operators', async () => {
  for (const [input, result] of [
    ['6 * 8', 48],
    ['2 + 3 * 4', 14],
    ['(-2.5 + .5) / -2', 1],
    ['2**3**2', 512],
    ['10 - 4 - 2', 4],
  ] as const) {
    const response = await calculate(input);
    assert.equal(response.isError, false);
    assert.equal(response.content[0].text, `${input} = ${result}`);
  }
});

test('sandbox arithmetic rejects incomplete, non-arithmetic, and non-finite inputs', async () => {
  for (const input of ['', '1/0', '(2+3', '2(3)', '5hello', '1 +', '1..2', '1//2', '1+'.repeat(121)]) {
    assert.equal((await calculate(input)).isError, true, input);
  }
});
