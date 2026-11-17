/**
 * Connects an MCP client to the per-request server over the SDK's in-memory
 * transport, and adapts the server's tool list to the OpenAI-compatible
 * `tools` shape Groq expects.
 */
'use strict';
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { buildMcpServer } = require('./server');

async function connectTools(ctx, options) {
  const server = buildMcpServer(ctx, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'throttlein-assistant-agent', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  return {
    tools,
    groqTools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.inputSchema || { type: 'object', properties: {} } } })),
    call: (name, args) => client.callTool({ name, arguments: args || {} }),
    close: async () => { await client.close().catch(() => {}); await server.close().catch(() => {}); },
  };
}

module.exports = { connectTools };
