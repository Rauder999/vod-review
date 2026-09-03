// Unit tests for the pure core of index.html (URL parsing, sync math, formatting,
// snapshot validation). No dependencies: run with `node --test tests/`.
//
// index.html is a single file with no build step, so instead of importing a module
// we slice the block between the PURE CORE START / END markers out of the page and
// evaluate it. That block must stay free of DOM / window / S references.

import { readFileSync } from 'node:fs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractCore() {
  const start = html.indexOf('// ── PURE CORE START ──');
  const end = html.indexOf('// ── PURE CORE END ──');
  assert.ok(start > 0 && end > start, 'PURE CORE markers missing from index.html');
  const src = html.slice(start, end);
  return new Function(src + `
    return { getYT, getTwitch, parseSource, platLabel, watchUrl, syncShift, fmt, ageLabel, esc, ytErrorInfo, validateSnapshot };
  `)();
}

const core = extractCore();
const { getYT, getTwitch, parseSource, watchUrl, syncShift, fmt, ageLabel, esc, ytErrorInfo, validateSnapshot } = core;

describe('index.html script', () => {
  test('parses as JavaScript (syntax check of the whole inline script)', () => {
    const open = html.lastIndexOf('<script>');
    const close = html.lastIndexOf('</script>');
    assert.ok(open > 0 && close > open);
    const src = html.slice(open + '<script>'.length, close);
    assert.doesNotThrow(() => new Function(src));
  });

  test('pure core block does not touch the page', () => {
    const start = html.indexOf('// ── PURE CORE START ──');
    const end = html.indexOf('// ── PURE CORE END ──');
    const src = html.slice(start, end);
    for (const banned of ['document.', 'window.', 'localStorage', 'S.povs', 'S.players', 'getElementById']) {
      assert.ok(!src.includes(banned), `pure core must not reference ${banned}`);
    }
  });
});

describe('YouTube parsing', () => {
  const YT = 'dQw4w9WgXcQ';
  const cases = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', YT],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120s&list=PL123', YT],
    ['https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ', YT],
    ['https://youtu.be/dQw4w9WgXcQ', YT],
    ['https://youtu.be/dQw4w9WgXcQ?t=43', YT],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', YT],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?feature=share', YT],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', YT],
    ['dQw4w9WgXcQ', YT],
  ];
  for (const [input, expected] of cases) {
    test(`getYT(${input})`, () => assert.equal(getYT(input), expected));
    test(`parseSource(${input}) is youtube`, () =>
      assert.deepEqual(parseSource(input), { platform: 'youtube', vid: expected }));
  }

  test('rejects ids that are not 11 chars', () => {
    assert.equal(getYT('https://www.youtube.com/watch?v=short'), null);
    assert.equal(getYT('tooLongForAnId123'), null);
  });

  test('id with underscore and dash survives', () => {
    assert.equal(getYT('https://youtu.be/a-b_c-d_e-f'), 'a-b_c-d_e-f');
  });
});

describe('Twitch parsing', () => {
  const cases = [
    ['https://www.twitch.tv/videos/2189765432', '2189765432'],
    ['https://twitch.tv/videos/2189765432?t=1h02m03s', '2189765432'],
    ['https://www.twitch.tv/somechannel/v/2189765432', '2189765432'],
    ['https://m.twitch.tv/videos/2189765432', '2189765432'],
    ['2189765432', '2189765432'],
    ['v2189765432', '2189765432'],
  ];
  for (const [input, expected] of cases) {
    test(`getTwitch(${input})`, () => assert.equal(getTwitch(input), expected));
    test(`parseSource(${input}) is twitch`, () =>
      assert.deepEqual(parseSource(input), { platform: 'twitch', vid: expected }));
  }

  test('channel page (no video) is not a VOD', () => {
    assert.equal(parseSource('https://www.twitch.tv/somechannel'), null);
  });

  test('clips are not VODs', () => {
    assert.equal(parseSource('https://clips.twitch.tv/SomeClipName'), null);
    assert.equal(parseSource('https://www.twitch.tv/somechannel/clip/SomeClipName'), null);
  });

  test('short digit strings are not twitch ids', () => {
    assert.equal(getTwitch('12345'), null);
  });
});

describe('parseSource edge cases', () => {
  test('empty / garbage / null', () => {
    assert.equal(parseSource(''), null);
    assert.equal(parseSource('   '), null);
    assert.equal(parseSource(null), null);
    assert.equal(parseSource(undefined), null);
    assert.equal(parseSource('hello world'), null);
    assert.equal(parseSource('https://example.com/some/page'), null);
  });

  test('lenient: any URL carrying v=<11 chars> is treated as youtube (documented behavior)', () => {
    assert.deepEqual(parseSource('https://example.com/watch?v=dQw4w9WgXcQ'), { platform: 'youtube', vid: 'dQw4w9WgXcQ' });
  });

  test('trims whitespace', () => {
    assert.deepEqual(parseSource('  https://youtu.be/dQw4w9WgXcQ  '), { platform: 'youtube', vid: 'dQw4w9WgXcQ' });
  });

  test('11 digits bare is twitch, 11 mixed chars bare is youtube', () => {
    assert.deepEqual(parseSource('12345678901'), { platform: 'twitch', vid: '12345678901' });
    assert.deepEqual(parseSource('1234567890a'), { platform: 'youtube', vid: '1234567890a' });
  });

  test('a twitch link never falls through to youtube', () => {
    assert.equal(parseSource('https://www.twitch.tv/directory'), null);
  });
});

describe('watchUrl', () => {
  test('per-platform watch links', () => {
    assert.equal(watchUrl({ platform: 'youtube', vid: 'dQw4w9WgXcQ' }), 'https://youtu.be/dQw4w9WgXcQ');
    assert.equal(watchUrl({ platform: 'twitch', vid: '2189765432' }), 'https://www.twitch.tv/videos/2189765432');
  });

  test('round-trips through parseSource', () => {
    for (const p of [{ platform: 'youtube', vid: 'dQw4w9WgXcQ' }, { platform: 'twitch', vid: '2189765432' }]) {
      assert.deepEqual(parseSource(watchUrl(p)), p);
    }
  });
});

describe('sync math', () => {
  // syncPt[i] = timestamp IN THAT VIDEO at the shared reference moment
  test('same offset: identity', () => {
    assert.equal(syncShift(100, 30, 30), 100);
  });

  test('target started recording later: shift forward', () => {
    // A flagged at 30s, B flagged at 90s. At A=100 the same moment in B is 160.
    assert.equal(syncShift(100, 30, 90), 160);
  });

  test('target started recording earlier: shift back', () => {
    assert.equal(syncShift(160, 90, 30), 100);
  });

  test('round trip A -> B -> A returns to the start', () => {
    const a = 1234.5, sa = 12.25, sb = 700.75;
    assert.equal(syncShift(syncShift(a, sa, sb), sb, sa), a);
  });

  test('before the target recording started is negative (caller clamps or hides)', () => {
    assert.ok(syncShift(10, 30, 5) < 0);
    assert.equal(Math.max(0, syncShift(10, 30, 5)), 0);
  });

  test('at the reference moment both POVs are at their own flag', () => {
    assert.equal(syncShift(30, 30, 90), 90);
    assert.equal(syncShift(90, 90, 30), 30);
  });

  test('sub-second precision is preserved', () => {
    assert.equal(syncShift(0.5, 0.25, 0.75), 1);
  });
});

describe('fmt', () => {
  test('m:ss', () => {
    assert.equal(fmt(0), '0:00');
    assert.equal(fmt(5), '0:05');
    assert.equal(fmt(65), '1:05');
    assert.equal(fmt(3599.9), '59:59');
    assert.equal(fmt(3600), '60:00');
    assert.equal(fmt(7325), '122:05');
  });

  test('invalid inputs render as 0:00', () => {
    assert.equal(fmt(null), '0:00');
    assert.equal(fmt(undefined), '0:00');
    assert.equal(fmt(NaN), '0:00');
    assert.equal(fmt(-3), '0:00');
  });
});

describe('ageLabel', () => {
  test('buckets', () => {
    assert.equal(ageLabel(0), 'just now');
    assert.equal(ageLabel(59_000), 'just now');
    assert.equal(ageLabel(5 * 60_000), '5 min ago');
    assert.equal(ageLabel(3 * 3_600_000), '3 h ago');
    assert.equal(ageLabel(2 * 86_400_000), '2 d ago');
    assert.equal(ageLabel(-1), '');
    assert.equal(ageLabel(NaN), '');
  });
});

describe('esc', () => {
  test('escapes html-significant characters', () => {
    assert.equal(esc('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
    assert.equal(esc(null), '');
    assert.equal(esc(42), '42');
  });
});

describe('ytErrorInfo', () => {
  test('documented codes have specific messages', () => {
    assert.equal(ytErrorInfo(100).title, 'Video unavailable');
    assert.equal(ytErrorInfo(101).title, 'Embedding disabled');
    assert.equal(ytErrorInfo(150).title, 'Embedding disabled');
    assert.equal(ytErrorInfo(2).title, 'Invalid video id');
    assert.equal(ytErrorInfo(5).title, 'Player error');
    assert.equal(ytErrorInfo(153).title, 'Blocked by YouTube');
  });
  test('unknown code still yields a message', () => {
    const r = ytErrorInfo(999);
    assert.equal(r.title, 'Playback error');
    assert.match(r.msg, /999/);
  });
});

describe('validateSnapshot', () => {
  const good = () => ({
    v: 1, savedAt: 1_700_000_000_000,
    povs: [
      { name: 'Alpha', platform: 'youtube', vid: 'dQw4w9WgXcQ', syncPt: 12.5, volume: 80 },
      { name: 'Bravo', platform: 'twitch', vid: '2189765432', syncPt: 40, volume: 0 },
    ],
    markers: [
      { id: 2, ts: 50, pov: 1, label: 'Mistake', c: '#f06b5b' },
      { id: 1, ts: 20, pov: 0, label: 'Good Play', c: '#4ecb8d' },
    ],
    notes: 'hello', active: 1, speed: 1.5, lastTime: 33.3,
  });

  test('accepts a well-formed snapshot and sorts markers by time', () => {
    const s = validateSnapshot(good());
    assert.ok(s);
    assert.equal(s.povs.length, 2);
    assert.equal(s.active, 1);
    assert.equal(s.speed, 1.5);
    assert.equal(s.lastTime, 33.3);
    assert.equal(s.notes, 'hello');
    assert.deepEqual(s.markers.map(m => m.id), [1, 2]);
    assert.equal(s.povs[1].volume, 0, 'volume 0 (muted) is preserved, not treated as missing');
  });

  test('rejects wrong version, missing povs, junk', () => {
    assert.equal(validateSnapshot(null), null);
    assert.equal(validateSnapshot('nope'), null);
    assert.equal(validateSnapshot({}), null);
    assert.equal(validateSnapshot({ v: 2, povs: good().povs }), null);
    assert.equal(validateSnapshot({ v: 1, povs: [] }), null);
    assert.equal(validateSnapshot({ v: 1, povs: [{ platform: 'vimeo', vid: '1' }] }), null);
    assert.equal(validateSnapshot({ v: 1, povs: [{ platform: 'youtube', vid: '' }] }), null);
  });

  test('normalizes bad optional fields instead of failing', () => {
    const raw = good();
    raw.povs[0].name = '   ';
    raw.povs[0].syncPt = -5;
    raw.povs[0].volume = 500;
    raw.active = 9;
    raw.speed = 10;
    raw.lastTime = -1;
    raw.notes = 123;
    raw.savedAt = 'yesterday';
    const s = validateSnapshot(raw);
    assert.equal(s.povs[0].name, 'Player 1');
    assert.equal(s.povs[0].syncPt, null);
    assert.equal(s.povs[0].volume, 100);
    assert.equal(s.active, 0);
    assert.equal(s.speed, 1);
    assert.equal(s.lastTime, 0);
    assert.equal(s.notes, '');
    assert.equal(s.savedAt, 0);
  });

  test('drops markers that point at a missing POV or carry a bad color', () => {
    const raw = good();
    raw.markers.push({ id: 3, ts: 1, pov: 5, label: 'x', c: '#000000' });
    raw.markers.push({ id: 4, ts: 1, pov: 0, label: 'x', c: 'red;background:url(x)' });
    raw.markers.push({ id: 5, ts: 'soon', pov: 0, label: 'x', c: '#000000' });
    const s = validateSnapshot(raw);
    assert.deepEqual(s.markers.map(m => m.id), [1, 2]);
  });

  test('caps POV count at maxPovs', () => {
    const raw = good();
    raw.povs = Array.from({ length: 10 }, (_, i) => ({ name: 'P' + i, platform: 'youtube', vid: 'dQw4w9WgXcQ' }));
    assert.equal(validateSnapshot(raw, 6).povs.length, 6);
  });

  test('markers array missing is fine', () => {
    const raw = good();
    delete raw.markers;
    assert.deepEqual(validateSnapshot(raw).markers, []);
  });
});
