const assert = require('node:assert/strict');
const User = require('../src/models/User');
const { updateProfile } = require('../src/modules/auth');

test('profile PIN exclusions reject incomplete codes without writing, and preserve complete codes', async () => {
  const writes = [];
  vi.spyOn(User, 'findByIdAndUpdate').mockImplementation(async (_id, updates) => {
    writes.push(updates);
    return { toSafeJSON: () => updates };
  });
  async function submit(value) {
    const result = { status: 200 };
    const res = {
      status(code) {
        result.status = code;
        return this;
      },
      json(body) {
        result.body = body;
        return this;
      },
    };
    // A refusal is a thrown AppError carrying the status the error layer answers with.
    try {
      await updateProfile({ user: { _id: 'test' }, body: { excludedPincodes: value } }, res, (error) => {
        throw error;
      });
    } catch (e) {
      result.status = e.status;
    }
    return result;
  }
  for (const invalid of ['123', '20130', '2013067', 'abcdef', '201306, 123']) {
    assert.equal((await submit(invalid)).status, 400);
  }
  assert.equal(writes.length, 0);
  const saved = await submit('201306, 190001, 201306');
  assert.deepEqual(saved.body.data.user.excludedPincodes, ['201306', '190001']);
  assert.deepEqual((await submit(['190001'])).body.data.user.excludedPincodes, ['190001']);
  assert.deepEqual((await submit([])).body.data.user.excludedPincodes, []);
});
