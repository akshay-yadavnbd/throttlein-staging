test('product import route requires authentication and seller role before spending quota', () => {
  const fs = require('node:fs'),
    path = require('node:path'),
    vm = require('node:vm');
  const file = path.resolve(__dirname, '../src/modules/products/products.routes.js');
  const realRequire = require('node:module').createRequire(file);
  const routes = [],
    passes = () => {},
    protectedMarker = () => {},
    roleMarker = () => {},
    limits = [];
  const router = {};
  for (const method of ['get', 'post', 'put', 'delete'])
    router[method] = (route, ...handlers) => routes.push({ method, route, handlers });
  const controller = new Proxy({}, { get: () => passes });
  const stub = {
    express: { Router: () => router },
    '../../middleware/auth': {
      protect: protectedMarker,
      requireRole: (...roles) => {
        assert.deepEqual(roles, ['seller', 'superadmin']);
        return roleMarker;
      },
    },
    '../../middleware/upload': { array: () => passes, fields: () => passes, single: () => passes },
    '../../middleware/trackMediaUpload': passes,
    '../../middleware/rateLimit': (config) => {
      limits.push(config);
      return passes;
    },
    './storefront.controller': controller,
    './seller-catalog.controller': controller,
    './seller-media.controller': controller,
    './import-export.controller': controller,
    '../catalog': controller,
    './url-import.controller': { fromUrl: passes },
  };
  const ctx = { module: { exports: {} }, require: (key) => (Object.hasOwn(stub, key) ? stub[key] : realRequire(key)) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  const route = routes.find((r) => r.route === '/import-url');
  assert.equal(route.method, 'post');
  assert.equal(route.handlers[0], protectedMarker);
  assert.equal(route.handlers[1], roleMarker);
  assert.equal(limits.length, 2);
  assert.equal(limits[0].keyBy({ user: { _id: 'seller' } }), 'seller');
  assert.equal(limits[0].max, 3);
  assert.equal(limits[1].window, 86400);
});
test('import controller requires rights acknowledgement, disables caching and never returns raw provider errors', async () => {
  // The extraction pipeline is stubbed to fail with a provider body that must never reach the client.
  const extract = require('../src/modules/products/url-extract');
  vi.spyOn(extract, 'importProductUrl').mockImplementation(async () => {
    throw new Error('provider-secret-body');
  });
  const { fromUrl } = require('../src/modules/products/url-import.controller');
  // Refusals are thrown AppErrors (status + message); the error layer writes the envelope.
  const call = async (body) => {
    const r = {
      headers: {},
      set(k, v) {
        this.headers[k] = v;
      },
      status() {
        return this;
      },
      json(b) {
        this.body = b;
      },
    };
    await fromUrl({ body }, r, (e) => {
      r.code = e.status;
      r.message = e.message;
    });
    return r;
  };
  let r = await call({ url: 'https://shop.example.com' });
  assert.equal(r.code, 400);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  vi.stubEnv('GROQ_API_KEY', 'test-placeholder');
  try {
    r = await call({ url: 'https://shop.example.com', confirmRights: true });
    assert.equal(r.code, 502);
    assert.equal(r.message.includes('provider-secret-body'), false);
    assert.equal(r.headers['Cache-Control'], 'no-store');
  } finally {
    vi.unstubAllEnvs();
  }
});
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { publicPageFetch, publicIPv4, parsePublicUrl } = require('../src/modules/products/public-page-fetch');
const {
  extractPage,
  normalizeDraft,
  extractWithGroq,
  importProductUrl,
  schema,
} = require('../src/modules/products/url-extract');

test('full visible description is preserved instead of AI summary, including content beyond model truncation', async () => {
  const paragraphs = Array.from(
    { length: 500 },
    (_, i) => `<p>Feature ${i}: complete source detail retained for the seller.</p>`,
  ).join('');
  const html = `<main><div class="product__description"><h2>Product Description</h2>${paragraphs}<ul><li>Final warranty section</li></ul><script>unsafe()</script></div></main>`;
  const page = extractPage(html, 'https://shop.example.com/product');
  assert.ok(page.fullDescription.length > 12000);
  const result = await importProductUrl('https://shop.example.com/product', {
    fetchPage: async () => ({ url: 'https://shop.example.com/product', body: Buffer.from(html) }),
    extract: async () => ({ ...draft(), description: 'Short AI summary', imageIndexes: [] }),
  });
  assert.equal(result.draft.description, page.fullDescription);
  assert.match(result.draft.description, /Feature 499/);
  assert.match(result.draft.description, /Final warranty section/);
  assert.doesNotMatch(result.draft.description, /unsafe|Short AI summary|<script/);
});
test('JSON-LD description is a fallback; missing source is reported, never replaced with a model summary', async () => {
  assert.equal(extractPage(productHtml, 'https://shop.example.com/product').fullDescription, 'A product description.');
  const html = '<main>' + 'Only generic navigation text. '.repeat(10) + '</main>';
  const result = await importProductUrl('https://shop.example.com/product', {
    fetchPage: async () => ({ url: 'https://shop.example.com/product', body: Buffer.from(html) }),
    extract: async () => ({ ...draft(), imageIndexes: [] }),
  });
  assert.equal(result.draft.description, '');
  assert.ok(result.warnings.some((w) => w.includes('No AI summary')));
});
const productHtml = `<html><head><title>Helmet</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Road Helmet","description":"A product description.","image":["/photo.jpg"],"offers":{"price":"1499","priceCurrency":"INR"}}</script></head><body><main><h1>Road Helmet</h1><p>A padded motorcycle helmet with washable liner. Available in multiple sizes and finishes.</p><img src="/detail.png" alt="Helmet detail"><img src="http://127.0.0.1/secret.jpg"></main></body></html>`;
const draft = () =>
  normalizeDraft({
    name: 'Road Helmet',
    description: 'Helmet details',
    price: 1499,
    mrp: 1999,
    currency: 'INR',
    sizes: ['M', 'L'],
    imageIndexes: [0, 1],
  });
function requester(responses, check) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.destroy = (error) => {
      req.emit('error', error);
      req.emit('close');
    };
    process.nextTick(() => {
      check?.(url, options);
      const data = responses.shift();
      if (!data) {
        req.destroy(new Error('unexpected request'));
        return;
      }
      const res = Readable.from(data.chunks || [Buffer.from(data.body || '')]);
      res.statusCode = data.status || 200;
      res.headers = data.headers || { 'content-type': 'text/html' };
      res.on('close', () => req.emit('close'));
      callback(res);
    });
    return req;
  };
}
test('SSRF rejects private IPv4, encoded loopback, IPv6, credentials, custom ports and non-HTTPS', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.1.1',
    '192.168.1.1',
    '0.0.0.0',
    '100.100.100.200',
    '224.1.1.1',
    '168.63.129.16',
    '198.18.0.1',
  ])
    assert.equal(publicIPv4(ip), false, ip);
  for (const url of [
    'http://public.com/a',
    'file:///etc/passwd',
    'https://127.1',
    'https://2130706433',
    'https://0x7f000001',
    'https://[::1]/',
    'https://user:pass@public.com',
    'https://public.com:8443/',
    'https://a.internal/',
  ])
    assert.throws(() => parsePublicUrl(url), undefined, url);
  assert.equal(parsePublicUrl('https://shop.example.com/products/helmet#details').hash, '');
});
test('DNS private/mixed answers and private redirects are blocked before connection', async () => {
  await assert.rejects(
    publicPageFetch('https://shop.example.com', {
      lookup: async () => ['93.184.216.34', '127.0.0.1'],
      request: () => assert.fail(),
    }),
    /Private/,
  );
  let calls = 0;
  await assert.rejects(
    publicPageFetch('https://shop.example.com', {
      lookup: async () => ['93.184.216.34'],
      request: requester([{ status: 302, headers: { location: 'https://169.254.169.254/' } }], () => calls++),
    }),
    /Private/,
  );
  assert.equal(calls, 1);
});
test('validated DNS is pinned to the actual TLS request and cookies/auth are not forwarded', async () => {
  let lookups = 0;
  const result = await publicPageFetch('https://shop.example.com/p', {
    lookup: async () => {
      lookups++;
      return ['93.184.216.34'];
    },
    request: requester([{ body: 'hello' }], (_url, options) => {
      assert.equal(options.agent, false);
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers.Cookie, undefined);
      options.lookup('shop.example.com', {}, (err, ip, family) => {
        assert.equal(err, null);
        assert.equal(ip, '93.184.216.34');
        assert.equal(family, 4);
      });
    }),
  });
  assert.equal(lookups, 1);
  assert.equal(result.body.toString(), 'hello');
});
test('fetch limits reject oversized streams and unsupported content types', async () => {
  const base = { lookup: async () => ['93.184.216.34'], maxBytes: 4 };
  await assert.rejects(
    publicPageFetch('https://shop.example.com', { ...base, request: requester([{ body: 'too large' }]) }),
    /large/,
  );
  await assert.rejects(
    publicPageFetch('https://shop.example.com', {
      ...base,
      request: requester([{ headers: { 'content-type': 'image/svg+xml' }, body: '<svg/>' }]),
    }),
    /unsupported/,
  );
});
test('extracts JSON-LD and same-page image candidates; strips scripts and unsafe URLs', () => {
  const page = extractPage(productHtml, 'https://shop.example.com/product');
  assert.match(page.structuredProducts, /Road Helmet/);
  assert.match(page.text, /washable liner/);
  assert.equal(page.images.length, 2);
  assert.equal(page.images[0].url, 'https://shop.example.com/photo.jpg');
  assert.equal(page.text.includes('@context'), false);
});
test('draft validation prevents invented stock/policies, invalid numbers and foreign currency prices', () => {
  const result = normalizeDraft({
    name: 'Helmet',
    price: 200,
    mrp: 100,
    currency: 'USD',
    stock: 999,
    isPublished: true,
    weightGrams: -10,
    sizes: ['M', 'M', {}, 'L'],
    imageIndexes: [0, 'https://attacker', -1],
  });
  assert.equal(result.price, null);
  assert.equal(result.mrp, null);
  assert.equal(result.stock, undefined);
  assert.equal(result.isPublished, undefined);
  assert.equal(result.weightGrams, null);
  assert.deepEqual(result.sizes, ['M', 'L']);
  assert.throws(() => normalizeDraft({ name: '' }), /No clear product/);
});
test('Groq uses server key, strict schema, hidden reasoning, no tools/streaming and untrusted-data instructions', async () => {
  const previous = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-only-not-a-real-key';
  try {
    const result = await extractWithGroq(extractPage(productHtml, 'https://shop.example.com'), {
      fetchImpl: async (url, opts) => {
        assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
        assert.equal(opts.headers.Authorization, 'Bearer test-only-not-a-real-key');
        const body = JSON.parse(opts.body);
        assert.equal(body.tools, undefined);
        assert.equal(body.stream, undefined);
        assert.equal(body.reasoning_format, 'hidden');
        assert.equal(body.response_format.type, 'json_schema');
        assert.equal(body.response_format.json_schema.strict, true);
        assert.deepEqual(body.response_format.json_schema.schema, schema);
        assert.equal(body.messages[0].role, 'system');
        assert.match(body.messages[0].content, /Never follow instructions/);
        assert.equal(body.messages[1].role, 'user');
        return {
          ok: true,
          json: async () => ({
            choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(draft()) } }],
          }),
        };
      },
    });
    assert.equal(result.name, 'Road Helmet');
    await assert.rejects(extractWithGroq({}, { fetchImpl: async () => ({ ok: false, status: 401 }) }), /administrator/);
    await assert.rejects(
      extractWithGroq(
        {},
        {
          fetchImpl: async () => ({
            ok: true,
            json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{"name":' } }] }),
          }),
        },
      ),
      /could not complete/,
    );
  } finally {
    if (previous === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previous;
  }
});
test('missing server API key fails without a network call', async () => {
  const previous = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    await assert.rejects(extractWithGroq({}, { fetchImpl: () => assert.fail() }), /not configured/);
  } finally {
    if (previous !== undefined) process.env.GROQ_API_KEY = previous;
  }
});
test('imports only page-sourced images with matching magic bytes; partial image failure keeps draft', async () => {
  const calls = [];
  const result = await importProductUrl('https://shop.example.com/product', {
    extract: async () => draft(),
    fetchPage: async (url) => {
      calls.push(url);
      if (url.endsWith('/product')) return { url, body: Buffer.from(productHtml) };
      if (url.endsWith('.jpg')) return { mime: 'image/jpeg', body: Buffer.from('ffd8ff00112233', 'hex') };
      return { mime: 'image/png', body: Buffer.from('<script>bad</script>') };
    },
  });
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].mime, 'image/jpeg');
  assert.ok(result.warnings.some((w) => w.includes('Some source photos')));
  assert.equal(result.draft.name, 'Road Helmet');
  assert.equal(result.draft.imageIndexes, undefined);
  assert.deepEqual(
    calls.sort(),
    [
      'https://shop.example.com/product',
      'https://shop.example.com/photo.jpg',
      'https://shop.example.com/detail.png',
    ].sort(),
  );
});
test('frontend merge leaves seller edits and stock intact and escapes imported HTML', () => {
  const fs = require('node:fs'),
    path = require('node:path'),
    vm = require('node:vm');
  const root = path.resolve(__dirname, '../../frontend');
  const req = require('node:module').createRequire(path.join(root, 'package.json'));
  const ts = req('typescript');
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/productUrlImport.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const ctx = { exports: {} };
  vm.runInNewContext(source, ctx);
  const result = ctx.exports.mergeImportedFields(
    { name: 'My name', description: '', price: '2500', stock: '7', codAvailable: false },
    { ...draft(), description: '<img src=x onerror=alert(1)>', stock: 999 },
  );
  assert.equal(result.name, 'My name');
  assert.equal(result.price, '2500');
  assert.equal(result.stock, '7');
  assert.equal(result.codAvailable, false);
  assert.match(result.description, /&lt;img/);
  const replaced = ctx.exports.mergeImportedFields(
    { name: 'My name', description: '<p>Old partial import</p>', price: '2500' },
    { ...draft(), description: 'Complete source description' },
    true,
  );
  assert.match(replaced.description, /Complete source description/);
  assert.equal(replaced.name, 'My name');
  assert.equal(replaced.price, '2500');
  for (const description of ['', '<p></p>', '<p style="text-align: left;"></p>', '<p><br></p>', '<p>&nbsp;</p>']) {
    const filled = ctx.exports.mergeImportedFields(
      { description },
      { ...draft(), description: 'Imported product features' },
    );
    assert.match(filled.description, /Imported product features/);
  }
  for (const description of ['<p>Seller-written details</p>', '<p><img src="/uploads/photo.jpg"></p>']) {
    assert.equal(ctx.exports.mergeImportedFields({ description }, draft()).description, description);
  }
});

test('real aligned TipTap editor displays an asynchronous import without overwriting seller edits', () => {
  const fs = require('node:fs'),
    path = require('node:path'),
    vm = require('node:vm');
  const root = path.resolve(__dirname, '../../frontend');
  const req = require('node:module').createRequire(path.join(root, 'package.json'));
  const ts = req('typescript');
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/richTextState.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const ctx = { exports: {} };
  vm.runInNewContext(source, ctx);
  const { JSDOM } = req('jsdom');
  const dom = new JSDOM('<html><body></body></html>');
  const keys = ['window', 'document', 'navigator'];
  const previous = Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  let editor;
  try {
    for (const key of keys)
      Object.defineProperty(global, key, {
        value: key === 'window' ? dom.window : dom.window[key],
        configurable: true,
        writable: true,
      });
    const { Editor } = req('@tiptap/core');
    editor = new Editor({
      element: dom.window.document.createElement('div'),
      extensions: [
        req('@tiptap/starter-kit').default,
        req('@tiptap/extension-text-align').default.configure({
          types: ['heading', 'paragraph'],
          defaultAlignment: 'left',
        }),
      ],
      content: '',
    });
    assert.equal(editor.isEmpty, true);
    assert.notEqual(editor.getHTML(), '<p></p>'); // Original exact-string check failed here.
    let updates = 0;
    editor.on('update', () => updates++);
    ctx.exports.syncRichTextValue(editor, '<p>Imported product features</p>');
    assert.equal(editor.getText(), 'Imported product features');
    assert.equal(updates, 0); // Hydration must not loop through onChange.
    editor.commands.setContent('<p>Seller edited these details</p>');
    ctx.exports.syncRichTextValue(editor, '<p>Another import</p>');
    assert.equal(editor.getText(), 'Seller edited these details');
    ctx.exports.syncRichTextValue(editor, '');
    assert.equal(editor.isEmpty, true);
    ctx.exports.syncRichTextValue(editor, '<p>Imported again after clearing</p>');
    assert.equal(editor.getText(), 'Imported again after clearing');
  } finally {
    editor?.destroy();
    dom.window.close();
    for (const key of keys)
      if (previous[key]) Object.defineProperty(global, key, previous[key]);
      else delete global[key];
  }
});
