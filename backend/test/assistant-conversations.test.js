const assert = require('node:assert/strict');
const path = require('node:path');

// Stub the model so the controller runs without a database, and record every filter it uses.
const calls = [];
const chain = (value) => ({
  select() {
    return this;
  },
  sort() {
    return this;
  },
  skip() {
    return this;
  },
  limit() {
    return this;
  },
  lean: async () => value,
});
const Fake = {
  MAX_MESSAGES: 200,
  MAX_PER_USER: 100,
  find: (f) => {
    calls.push(['find', f]);
    return chain([]);
  },
  findOne: (f) => {
    calls.push(['findOne', f]);
    return chain(
      f._id === 'aaaaaaaaaaaaaaaaaaaaaaaa'
        ? { _id: f._id, title: 'Low stock', messages: [{ role: 'user', content: 'hi' }] }
        : null,
    );
  },
  findOneAndUpdate: async (f, u) => {
    calls.push(['update', f, u]);
    return { _id: f._id, title: 't', messageCount: 2 };
  },
  create: async (doc) => {
    calls.push(['create', doc]);
    return { _id: 'cccccccccccccccccccccccc', ...doc };
  },
  deleteOne: async (f) => {
    calls.push(['deleteOne', f]);
    return { deletedCount: 1 };
  },
  deleteMany: async () => ({ deletedCount: 0 }),
};
require.cache[path.resolve(__dirname, '../src/modules/assistant/conversation.model.js')] = {
  exports: Fake,
  loaded: true,
  id: 'x',
};
const ctrl = {
  ...require('../src/modules/assistant/conversations.controller'),
  cleanMessages: require('../src/modules/assistant/conversations.service').cleanMessages,
};

const ME = '111111111111111111111111';
const run = (fn, req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(n) {
        this.statusCode = n;
        return this;
      },
      json(b) {
        this.body = b;
        resolve(this);
        return this;
      },
      end() {
        resolve(this);
        return this;
      },
    };
    Promise.resolve(
      fn({ user: { _id: ME }, query: {}, params: {}, body: {}, ...req }, res, (e) => {
        res.error = e;
        if (e && e.status) res.statusCode = e.status;
        resolve(res);
      }),
    ).catch((e) => {
      res.error = e;
      if (e && e.status) res.statusCode = e.status;
      resolve(res);
    });
  });

test('every read and write is scoped to the signed-in user', async () => {
  calls.length = 0;
  await run(ctrl.list, {});
  await run(ctrl.getOne, { params: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' } });
  await run(ctrl.append, {
    params: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
    body: {
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
      ],
    },
  });
  await run(ctrl.remove, { params: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' } });
  for (const [op, f] of calls) if (op !== 'create') assert.equal(String(f.user), ME, `${op} is scoped to the user`);
  const missing = await run(ctrl.getOne, { params: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb' } });
  assert.equal(missing.statusCode, 404);
  const bad = await run(ctrl.getOne, { params: { id: 'not-an-id' } });
  assert.equal(bad.statusCode, 404);
});

test('a new chat is titled from the first question and owned by the user', async () => {
  calls.length = 0;
  const res = await run(ctrl.create, {
    body: {
      messages: [
        { role: 'user', content: '  Show my   low-stock products ' },
        {
          role: 'assistant',
          content: 'Here.',
          table: { tool: 'list_my_products', args: { stockBelow: 6 }, total: 15 },
        },
      ],
    },
  });
  assert.equal(res.statusCode, 201);
  const [, doc] = calls.find((c) => c[0] === 'create');
  assert.equal(String(doc.user), ME);
  assert.equal(doc.title, 'Show my low-stock products');
  assert.deepEqual(doc.messages[1].table, { tool: 'list_my_products', args: { stockBelow: 6 }, total: 15 });
});

test('messages are cleaned: bad roles, empty text and user-side tables are dropped', () => {
  const out = ctrl.cleanMessages([
    { role: 'system', content: 'evil' },
    { role: 'user', content: '   ' },
    { role: 'user', content: 'ok', table: { tool: 'x' } },
    { role: 'assistant', content: 'a', table: { tool: 'DROP TABLE', args: {} } },
    'junk',
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].table, undefined);
  assert.equal(out[1].table, undefined);
});

test('answers the { data } envelope; delete is 204 with no body (the chatbot flattens it in fromEnvelope)', async () => {
  const list = await run(ctrl.list, {});
  assert.deepEqual(list.body, { data: { items: [] } });
  const one = await run(ctrl.getOne, { params: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' } });
  assert.deepEqual(Object.keys(one.body), ['data']);
  assert.equal(one.body.data.conversation.title, 'Low stock');
  assert.deepEqual(
    one.body.data.conversation.messages.map((m) => [m.role, m.content]),
    [['user', 'hi']],
  );
  const created = await run(ctrl.create, { body: { messages: [{ role: 'user', content: 'Hello' }] } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.data.conversation.title, 'Hello');
  const renamed = await run(ctrl.rename, { params: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, body: { title: 'Stock' } });
  assert.deepEqual(Object.keys(renamed.body.data), ['conversation']);
  const removed = await run(ctrl.remove, { params: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' } });
  assert.equal(removed.error, undefined);
  assert.equal(removed.statusCode, 204);
  assert.equal(removed.body, undefined);
});
