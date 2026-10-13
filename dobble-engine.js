/* 嗒宝 Dobble — game engine (pure logic, no DOM).
 * Deck = order-7 projective plane (57 symbols, 57 lines of 8) minus 2 lines = 55 cards.
 * Modes: tower (混乱高塔), well (水井), potato (烫手山芋), duel (平手对决), practice (练习).
 * State objects are plain JSON; the RNG state lives in state.rng so games are reproducible.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DobbleEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ORDER = 7;

  // 57 web symbols: one emoji each (no ZWJ, no flags, no skin tones), short Chinese name.
  var SYMBOLS = [
    { e: '🍉', n: '西瓜' }, { e: '🍓', n: '草莓' }, { e: '🍒', n: '樱桃' }, { e: '🍇', n: '葡萄' },
    { e: '🍌', n: '香蕉' }, { e: '🍍', n: '菠萝' }, { e: '🥕', n: '胡萝卜' }, { e: '🔮', n: '水晶球' },
    { e: '🍄', n: '蘑菇' }, { e: '🍕', n: '披萨' }, { e: '🍩', n: '甜甜圈' }, { e: '🍦', n: '冰淇淋' },
    { e: '🎂', n: '蛋糕' }, { e: '🍔', n: '汉堡' }, { e: '🍭', n: '棒棒糖' }, { e: '🌸', n: '樱花' },
    { e: '🐸', n: '青蛙' }, { e: '🐷', n: '小猪' }, { e: '🐼', n: '熊猫' }, { e: '🐧', n: '企鹅' },
    { e: '🐙', n: '章鱼' }, { e: '🦀', n: '螃蟹' }, { e: '🐢', n: '乌龟' }, { e: '🐳', n: '鲸鱼' },
    { e: '🐝', n: '蜜蜂' }, { e: '🐞', n: '瓢虫' }, { e: '🦋', n: '蝴蝶' }, { e: '🐌', n: '蜗牛' },
    { e: '🦄', n: '独角兽' }, { e: '🐘', n: '大象' }, { e: '🦊', n: '狐狸' }, { e: '🐰', n: '兔子' },
    { e: '🐵', n: '猴子' }, { e: '🦉', n: '猫头鹰' }, { e: '💧', n: '水滴' }, { e: '⚓', n: '船锚' },
    { e: '⏰', n: '闹钟' }, { e: '⚽', n: '足球' }, { e: '🏀', n: '篮球' }, { e: '🎈', n: '气球' },
    { e: '🎁', n: '礼物' }, { e: '☔', n: '雨伞' }, { e: '💡', n: '灯泡' }, { e: '🎸', n: '吉他' },
    { e: '🚀', n: '火箭' }, { e: '🚗', n: '汽车' }, { e: '🌈', n: '彩虹' }, { e: '⭐', n: '星星' },
    { e: '🔥', n: '火焰' }, { e: '⛄', n: '雪人' }, { e: '🌵', n: '仙人掌' }, { e: '🌻', n: '向日葵' },
    { e: '🍀', n: '四叶草' }, { e: '💎', n: '钻石' }, { e: '👑', n: '皇冠' }, { e: '👻', n: '幽灵' },
    { e: '🎲', n: '骰子' }
  ];

  // The physical deck 《嗒宝：宝可梦》 — 符号名称示例 from the booklet (57).
  var POKEMON = [
    '妙蛙种子', '小火龙', '喷火龙', '杰尼龟', '巴大蝶', '皮卡丘', '胖丁', '喵喵', '可达鸭', '小火马(伽勒尔的样子)',
    '呆呆兽', '小磁怪', '耿鬼', '暴鲤龙', '百变怪', '伊布', '卡比兽', '快龙', '超梦', '梦幻',
    '波克比', '月亮伊布', '果然翁', '巨钳螳螂', '班基拉斯', '时拉比', '波加曼', '伦琴猫', '烈咬陆鲨', '路卡利欧',
    '冰伊布', '骑拉帝纳(起源形态)', '阿尔宙斯', '仙子伊布', '木木枭', '穿着熊', '托戈德玛尔', '谜拟丘', '敲音猴', '炎兔儿',
    '闪焰王牌', '泪眼蜥', '毛辫羊', '来电汪', '莫鲁贝可', '小智', '大木博士', '火属性', '草属性', '电属性',
    '水属性', '文柚果', '橙橙果', '宝芬', '精灵球', '大师球', '手机洛托姆'
  ];

  var MODES = {
    tower: { name: '混乱高塔', short: '玩法1' },
    well: { name: '水井', short: '玩法2' },
    potato: { name: '烫手山芋', short: '玩法3' },
    duel: { name: '对决', short: '平手' },
    practice: { name: '练习', short: '秒表' }
  };

  // Bot reaction medians (ms) — spec: ≈ 7s / 4.5s / 2.8s, ±35%.
  var BOT_LEVELS = {
    novice: { label: '新手', median: 7000, mistake: 0.05 },
    normal: { label: '普通', median: 4500, mistake: 0.035 },
    expert: { label: '高手', median: 2800, mistake: 0.02 }
  };
  var JITTER = 0.35;

  // ---------------------------------------------------------------- RNG
  // mulberry32, with the state stored in a plain object ({ rng: int }) so it serialises.
  function rngNext(holder) {
    var a = (holder.rng + 0x6D2B79F5) | 0;
    holder.rng = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function makeRng(seed) {
    var h = { rng: (seed | 0) || 1 };
    var f = function () { return rngNext(h); };
    f.holder = h;
    return f;
  }
  function shuffle(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---------------------------------------------------------------- deck
  // Projective plane of order n (n prime). Points: affine (x,y) -> x*n+y (0..n²-1),
  // slope points m -> n²+m, vertical point -> n²+n. Lines: y = m·x+b (+ slope point m),
  // x = c (+ vertical point), and the line at infinity.
  function buildPlane(n) {
    n = n || ORDER;
    var lines = [];
    var x, y, m, b, c;
    for (m = 0; m < n; m++) {
      for (b = 0; b < n; b++) {
        var L = [];
        for (x = 0; x < n; x++) L.push(x * n + ((m * x + b) % n));
        L.push(n * n + m);
        lines.push(L);
      }
    }
    for (c = 0; c < n; c++) {
      var V = [];
      for (y = 0; y < n; y++) V.push(c * n + y);
      V.push(n * n + n);
      lines.push(V);
    }
    var I = [];
    for (m = 0; m <= n; m++) I.push(n * n + m);
    lines.push(I);
    return lines;
  }

  // Fixed permutation point -> symbol so neighbouring emoji don't cluster on the same cards.
  var SYMBOL_OF_POINT = shuffle(range(57), makeRng(20261012));
  function range(k) { var a = []; for (var i = 0; i < k; i++) a.push(i); return a; }

  // Drop the line at infinity and the line x = 6 → 55 cards, like the real deck.
  var DECK = buildPlane(ORDER).slice(0, 56).filter(function (_, i) { return i !== 55; })
    .map(function (line) { return line.map(function (p) { return SYMBOL_OF_POINT[p]; }); });

  function cardHas(card, sym) { return DECK[card].indexOf(sym) >= 0; }
  function shared(a, b) {
    var A = DECK[a], B = DECK[b];
    for (var i = 0; i < A.length; i++) if (B.indexOf(A[i]) >= 0) return A[i];
    return -1;
  }
  function symName(s) { return SYMBOLS[s] ? SYMBOLS[s].n : '?'; }
  function symEmoji(s) { return SYMBOLS[s] ? SYMBOLS[s].e : '?'; }
  function symLabel(s) { return symEmoji(s) + ' ' + symName(s); }

  // ---------------------------------------------------------------- card layout
  // 8 non-overlapping circles inside the unit circle with sizes ≈ 0.55×–1.35× and random rotation.
  // Deterministic per card (same card always looks the same, like a printed card).
  var LAYOUT_R = 0.93;   // usable radius (leave a white rim)
  var LAYOUT_GAP = 0.035;
  var MULT_MIN = 0.55, MULT_MAX = 1.35;

  function sizeMultipliers(rand) {
    var m = [];
    for (var i = 0; i < 8; i++) m.push(MULT_MIN + (MULT_MAX - MULT_MIN) * rand());
    // guarantee visible variety: one big, one small
    var iMax = 0, iMin = 0;
    for (i = 1; i < 8; i++) { if (m[i] > m[iMax]) iMax = i; if (m[i] < m[iMin]) iMin = i; }
    if (m[iMax] < 1.22) m[iMax] = 1.22 + 0.13 * rand();
    if (m[iMin] > 0.68) m[iMin] = MULT_MIN + 0.1 * rand();
    return m;
  }

  function packCircles(mult, rand) {
    var k = mult.length, R = LAYOUT_R, gap = LAYOUT_GAP;
    var sumSq = 0;
    for (var i = 0; i < k; i++) sumSq += mult[i] * mult[i];
    var density = 0.62;
    for (var attempt = 0; attempt < 80; attempt++) {
      if (attempt > 0 && attempt % 4 === 0) density -= 0.012;
      var base = R * Math.sqrt(density / sumSq);
      var rs = mult.map(function (m) { return m * base; });
      var pos = [];
      for (i = 0; i < k; i++) {
        var ang = rand() * Math.PI * 2, rad = Math.sqrt(rand()) * Math.max(0, R - rs[i]);
        pos.push([Math.cos(ang) * rad, Math.sin(ang) * rad]);
      }
      for (var it = 0; it < 600; it++) {
        var moved = false;
        for (i = 0; i < k; i++) {
          for (var j = i + 1; j < k; j++) {
            var dx = pos[j][0] - pos[i][0], dy = pos[j][1] - pos[i][1];
            var d = Math.sqrt(dx * dx + dy * dy), need = rs[i] + rs[j] + gap;
            if (d < need) {
              if (d < 1e-6) { var a2 = rand() * Math.PI * 2; dx = Math.cos(a2); dy = Math.sin(a2); d = 1; }
              var push = (need - d) * 0.52;
              var wi = rs[j] / (rs[i] + rs[j]), wj = rs[i] / (rs[i] + rs[j]);
              pos[i][0] -= dx / d * push * wi * 2; pos[i][1] -= dy / d * push * wi * 2;
              pos[j][0] += dx / d * push * wj * 2; pos[j][1] += dy / d * push * wj * 2;
              moved = true;
            }
          }
        }
        for (i = 0; i < k; i++) {
          var L = Math.sqrt(pos[i][0] * pos[i][0] + pos[i][1] * pos[i][1]), maxL = R - rs[i];
          if (L > maxL) { pos[i][0] *= maxL / L; pos[i][1] *= maxL / L; moved = true; }
        }
        if (!moved) break;
      }
      if (layoutValid(pos, rs, R, gap * 0.98)) {
        return { pos: pos, rs: rs, base: base };
      }
    }
    throw new Error('packCircles failed');
  }
  function layoutValid(pos, rs, R, gap) {
    for (var i = 0; i < pos.length; i++) {
      var L = Math.sqrt(pos[i][0] * pos[i][0] + pos[i][1] * pos[i][1]);
      if (L + rs[i] > R + 1e-9) return false;
      for (var j = i + 1; j < pos.length; j++) {
        var dx = pos[j][0] - pos[i][0], dy = pos[j][1] - pos[i][1];
        if (Math.sqrt(dx * dx + dy * dy) < rs[i] + rs[j] + gap - 1e-9) return false;
      }
    }
    return true;
  }

  var layoutCache = {};
  function layoutCard(card) {
    if (layoutCache[card]) return layoutCache[card];
    var rand = makeRng(9001 + card * 7919);
    var mult = sizeMultipliers(rand);
    var packed = packCircles(mult, rand);
    var syms = shuffle(DECK[card], rand);
    var out = syms.map(function (s, i) {
      return {
        s: s,
        x: packed.pos[i][0], y: packed.pos[i][1],
        r: packed.rs[i],
        m: mult[i],
        rot: Math.round(rand() * 360)
      };
    });
    layoutCache[card] = out;
    return out;
  }
  function slotOf(card, sym) {
    var L = layoutCard(card);
    for (var i = 0; i < L.length; i++) if (L[i].s === sym) return L[i];
    return null;
  }
  // nearest symbol to a point (unit coords) — used for generous tap targets
  function hitTest(card, ux, uy, slack) {
    var L = layoutCard(card), best = null, bestD = Infinity;
    for (var i = 0; i < L.length; i++) {
      var dx = ux - L[i].x, dy = uy - L[i].y;
      var d = Math.sqrt(dx * dx + dy * dy) - L[i].r;
      if (d < bestD) { bestD = d; best = L[i]; }
    }
    if (bestD > (slack == null ? 0.16 : slack)) return null;
    return best ? best.s : null;
  }

  // pairs of cards whose shared symbol differs a lot in size between the two cards
  function contrastPairs(limit) {
    var out = [];
    for (var a = 0; a < DECK.length; a++) {
      for (var b = a + 1; b < DECK.length; b++) {
        var s = shared(a, b), A = slotOf(a, s), B = slotOf(b, s);
        var ratio = Math.max(A.r, B.r) / Math.min(A.r, B.r);
        out.push({ a: a, b: b, sym: s, ratio: ratio, rotDiff: Math.abs(((A.rot - B.rot) % 360 + 540) % 360 - 180) });
      }
    }
    out.sort(function (p, q) { return q.ratio - p.ratio; });
    return out.slice(0, limit || 20);
  }

  // ---------------------------------------------------------------- games
  function top(arr) { return arr.length ? arr[arr.length - 1] : -1; }

  /* opts: { mode, players:[{name, human, ref}], seed, deckSize, rounds, deck:[stacked card order, top = last],
             practiceRounds } */
  function newGame(opts) {
    var mode = opts.mode;
    if (!MODES[mode]) throw new Error('unknown mode ' + mode);
    var s = {
      mode: mode,
      seed: opts.seed >>> 0,
      rng: (opts.seed | 0) || 1,
      players: (opts.players || [{ name: '你', human: true }]).map(function (p, i) {
        return { id: i, name: p.name, human: !!p.human, ref: p.ref == null ? i : p.ref, pile: [], penalty: 0 };
      }),
      center: [], aside: [], boxed: [],
      round: 0, rounds: 0, betweenRounds: false, roundLog: [],
      actions: 0, finished: false, result: null, practice: null, pair: null
    };
    var deck;
    if (opts.deck) deck = opts.deck.slice();
    else {
      deck = shuffle(range(DECK.length), function () { return rngNext(s); });
      if (opts.deckSize) deck = deck.slice(0, Math.max(opts.deckSize, s.players.length + 1));
    }
    var n = s.players.length, i;
    if (mode === 'tower') {
      if (n < 1) throw new Error('need players');
      for (i = 0; i < n; i++) s.players[i].pile.push(deck.pop());
      s.center = deck;                      // face-up 抓牌堆, top = last
    } else if (mode === 'well') {
      s.center.push(deck.pop());            // one face-up card in the middle
      var each = Math.floor(deck.length / n);
      for (var k = 0; k < each; k++) for (i = 0; i < n; i++) s.players[i].pile.push(deck.pop());
      s.boxed = deck;                       // can't be split evenly → back in the box
    } else if (mode === 'potato') {
      s.aside = deck;
      s.rounds = Math.min(opts.rounds || 5, maxPotatoRounds(n, deck.length));
      dealPotatoRound(s);
    } else if (mode === 'duel') {
      if (n !== 2) throw new Error('duel needs 2 players');
      s.players[0].pile.push(deck.pop());
      s.players[1].pile.push(deck.pop());
      s.aside = deck;
    } else if (mode === 'practice') {
      s.aside = deck;
      s.practice = { rounds: opts.practiceRounds || 10, found: 0 };
      s.pair = [s.aside.pop(), s.aside.pop()];
    }
    return s;
  }
  function maxPotatoRounds(n, deckLen) { return Math.max(1, Math.floor((deckLen == null ? DECK.length : deckLen) / n)); }

  function dealPotatoRound(s) {
    s.round += 1;
    s.betweenRounds = false;
    for (var i = 0; i < s.players.length; i++) {
      if (!s.aside.length) throw new Error('deck exhausted');
      s.players[i].pile = [s.aside.pop()];
    }
  }
  function nextRound(s) {
    if (s.mode !== 'potato' || !s.betweenRounds || s.finished) return false;
    dealPotatoRound(s);
    return true;
  }

  function activePlayers(s) {
    var out = [];
    for (var i = 0; i < s.players.length; i++) if (s.players[i].pile.length) out.push(i);
    return out;
  }

  // What player p should be comparing right now: [{other, a, b, sym}] (a = p's card).
  function comparisons(s, p) {
    if (s.finished) return [];
    var me = s.players[p];
    if (!me) return [];
    var out = [];
    if (s.mode === 'tower') {
      if (s.center.length) out.push({ other: 'center', a: top(me.pile), b: top(s.center) });
    } else if (s.mode === 'well') {
      if (me.pile.length && s.center.length) out.push({ other: 'center', a: top(me.pile), b: top(s.center) });
    } else if (s.mode === 'potato') {
      if (!s.betweenRounds && me.pile.length) {
        var n = s.players.length;
        for (var k = 1; k < n; k++) {
          var q = (p + k) % n;
          if (s.players[q].pile.length) out.push({ other: q, a: top(me.pile), b: top(s.players[q].pile) });
        }
      }
    } else if (s.mode === 'duel') {
      out.push({ other: 1 - p, a: top(me.pile), b: top(s.players[1 - p].pile) });
    } else if (s.mode === 'practice') {
      if (p === 0) out.push({ other: 'pair', a: s.pair[0], b: s.pair[1] });
    }
    out.forEach(function (c) { c.sym = shared(c.a, c.b); });
    return out;
  }
  function compareKey(s, p) {
    return comparisons(s, p).map(function (c) { return c.other + ':' + c.a + '-' + c.b; }).join('|');
  }
  function canShout(s, p) { return comparisons(s, p).length > 0; }

  /* Player p shouts symbol `sym` (optionally aiming at `other` = 'center' | player index).
     Returns { ok:true, event } and mutates s, or { ok:false, reason, onMine, onOthers } without changing s. */
  function shout(s, p, sym, other) {
    if (s.finished) return { ok: false, reason: 'finished' };
    var cmps = comparisons(s, p);
    if (!cmps.length) return { ok: false, reason: s.mode === 'potato' && s.betweenRounds ? 'between-rounds' : 'idle' };
    var aimed = cmps;
    if (other !== undefined && other !== null) {
      aimed = cmps.filter(function (c) { return c.other === other; });
      if (!aimed.length) return { ok: false, reason: 'bad-target', onMine: cardHas(cmps[0].a, sym), onOthers: [] };
    }
    var hit = aimed.filter(function (c) { return c.sym === sym; });
    if (!hit.length) {
      var onMine = cardHas(cmps[0].a, sym);
      var onOthers = aimed.filter(function (c) { return cardHas(c.b, sym); }).map(function (c) { return c.other; });
      return { ok: false, reason: onMine ? (onOthers.length ? 'other-target' : 'only-mine') : (onOthers.length ? 'only-other' : 'neither'), onMine: onMine, onOthers: onOthers };
    }
    var c = hit[0];
    var me = s.players[p], ev = { type: '', p: p, sym: sym, other: c.other, a: c.a, b: c.b };
    s.actions += 1;
    if (s.mode === 'tower') {
      var card = s.center.pop();
      me.pile.push(card);
      ev.type = 'take'; ev.card = card;
      if (!s.center.length) finish(s);
    } else if (s.mode === 'well') {
      var mine = me.pile.pop();
      s.center.push(mine);
      ev.type = 'drop'; ev.card = mine;
      if (!me.pile.length) finish(s, p);
    } else if (s.mode === 'potato') {
      var target = s.players[c.other];
      ev.type = 'pass'; ev.to = c.other; ev.n = me.pile.length; ev.cards = me.pile.slice();
      target.pile = target.pile.concat(me.pile);   // my cards go on top, my top stays on top
      me.pile = [];
      var act = activePlayers(s);
      if (act.length === 1) {
        var loser = s.players[act[0]];
        var got = loser.pile.length;
        loser.penalty += got;
        loser.pile = [];
        s.roundLog.push({ round: s.round, loser: act[0], n: got });
        ev.roundEnd = { round: s.round, loser: act[0], n: got };
        if (s.round >= s.rounds || s.aside.length < s.players.length) finish(s);
        else s.betweenRounds = true;
      }
    } else if (s.mode === 'duel') {
      ev.type = 'duel';
      finish(s, p);
    } else if (s.mode === 'practice') {
      ev.type = 'found';
      s.practice.found += 1;
      if (s.practice.found >= s.practice.rounds) finish(s);
      else {
        if (s.aside.length < 2) {
          var used = s.pair.slice();
          s.aside = shuffle(range(DECK.length).filter(function (x) { return used.indexOf(x) < 0; }), function () { return rngNext(s); });
        }
        s.pair = [s.aside.pop(), s.aside.pop()];
      }
    }
    if (s.finished) ev.finished = true;
    return { ok: true, event: ev };
  }

  function finish(s, winner) {
    s.finished = true;
    var ranking, winners;
    var P = s.players;
    if (s.mode === 'tower') {
      ranking = P.map(function (p) { return { p: p.id, value: p.pile.length }; })
        .sort(function (a, b) { return b.value - a.value; });
      var best = ranking[0].value;
      winners = ranking.filter(function (r) { return r.value === best; }).map(function (r) { return r.p; });
    } else if (s.mode === 'well') {
      ranking = P.map(function (p) { return { p: p.id, value: p.pile.length }; })
        .sort(function (a, b) { return (a.p === winner ? -1 : 0) - (b.p === winner ? -1 : 0) || a.value - b.value; });
      winners = [winner];
    } else if (s.mode === 'potato') {
      ranking = P.map(function (p) { return { p: p.id, value: p.penalty }; })
        .sort(function (a, b) { return a.value - b.value; });
      var low = ranking[0].value;
      winners = ranking.filter(function (r) { return r.value === low; }).map(function (r) { return r.p; });
    } else if (s.mode === 'duel') {
      ranking = [{ p: winner, value: 1 }, { p: 1 - winner, value: 0 }];
      winners = [winner];
    } else {
      ranking = [{ p: 0, value: s.practice ? s.practice.found : 0 }];
      winners = [0];
    }
    s.result = { winners: winners, ranking: ranking, tied: winners.length > 1 };
  }

  // Booklet 平手: 2 tied → 对决; 3+ tied → 烫手山芋 to reduce to 2, then 对决.
  function tiebreakStep(tied) {
    if (!tied || tied.length < 2) return { kind: 'none' };
    if (tied.length === 2) return { kind: 'duel', players: tied.slice() };
    return { kind: 'potato', players: tied.slice() };
  }

  /* Final places for the result screen.
     Without a tie: the engine ranking; equal values share a place.
     With a tie for first broken by the 平手 rules, tb = { winner: id, duelLoser: id|null, eliminated: [ids, in the
     order they were knocked out of the tie-break 烫手山芋] }: the tied players get distinct places — the winner, then
     the 对决 loser, then the knock-outs (the last one out ranks highest). Everyone else follows. */
  function standings(s, tb) {
    var res = s.result, tied = res.tied ? res.winners.slice() : [];
    var seq = [];
    if (tb) {
      seq.push(tb.winner);
      if (tb.duelLoser != null) seq.push(tb.duelLoser);
      seq = seq.concat((tb.eliminated || []).slice().reverse());
    }
    var place = function (r) { var i = seq.indexOf(r.p); return i < 0 ? seq.length : i; };
    var head = res.ranking.filter(function (r) { return tied.indexOf(r.p) >= 0; })
      .sort(function (a, b) { return place(a) - place(b); });
    var rest = res.ranking.filter(function (r) { return tied.indexOf(r.p) < 0; });
    var out = [], rank = 0, prev = null;
    head.concat(rest).forEach(function (r, i) {
      var isTied = tied.indexOf(r.p) >= 0;
      if ((isTied && tb) || i === head.length || r.value !== prev) rank = i + 1;
      prev = r.value;
      var how = null;
      if (isTied && tb) how = r.p === tb.winner ? 'won' : (r.p === tb.duelLoser ? 'duel' : ((tb.eliminated || []).indexOf(r.p) >= 0 ? 'out' : null));
      out.push({ p: r.p, value: r.value, rank: rank, tied: isTied, tiebreak: how });
    });
    return out;
  }

  // Overall winner of an evening = most mini-game wins.
  function tallyWins(winsByPlayer) {
    var ids = Object.keys(winsByPlayer);
    var best = -1;
    ids.forEach(function (k) { if (winsByPlayer[k] > best) best = winsByPlayer[k]; });
    return ids.filter(function (k) { return winsByPlayer[k] === best; });
  }

  // ---------------------------------------------------------------- bots
  /* Plan a bot's next shout from what it can see. `rand` = makeRng(...) function.
     Delay ≈ level median × (1 ± 35%), slightly slower for small symbols; with several candidate pairs
     (烫手山芋) the bot takes whichever it spots first. Rarely shouts a wrong symbol. */
  function botPlan(s, p, level, rand) {
    var cmps = comparisons(s, p);
    if (!cmps.length) return null;
    var L = typeof level === 'object' ? level : (BOT_LEVELS[level] || BOT_LEVELS.normal);
    var best = null;
    for (var i = 0; i < cmps.length; i++) {
      var c = cmps[i];
      var sz = (slotOf(c.a, c.sym).m + slotOf(c.b, c.sym).m) / 2;
      var difficulty = Math.max(0.88, Math.min(1.12, 1 + 0.3 * (0.95 - sz)));
      var t = L.median * difficulty * (1 + (rand() * 2 - 1) * JITTER);
      if (!best || t < best.delay) best = { delay: t, sym: c.sym, other: c.other, key: null, mistake: false };
    }
    if (rand() < (L.mistake || 0)) {
      var own = DECK[cmps[0].a].filter(function (x) { return !cmps.some(function (c) { return c.sym === x; }); });
      best.sym = own[Math.floor(rand() * own.length)];
      best.delay *= 0.75;
      best.mistake = true;
    }
    best.key = compareKey(s, p);
    return best;
  }

  return {
    ORDER: ORDER, SYMBOLS: SYMBOLS, POKEMON: POKEMON, MODES: MODES, BOT_LEVELS: BOT_LEVELS, JITTER: JITTER,
    DECK: DECK, LAYOUT_R: LAYOUT_R, LAYOUT_GAP: LAYOUT_GAP, MULT_MIN: MULT_MIN, MULT_MAX: MULT_MAX,
    rngNext: rngNext, makeRng: makeRng, shuffle: shuffle, range: range,
    buildPlane: buildPlane, cardHas: cardHas, shared: shared, symName: symName, symEmoji: symEmoji, symLabel: symLabel,
    layoutCard: layoutCard, slotOf: slotOf, hitTest: hitTest, contrastPairs: contrastPairs, layoutValid: layoutValid,
    newGame: newGame, nextRound: nextRound, comparisons: comparisons, compareKey: compareKey, canShout: canShout,
    shout: shout, activePlayers: activePlayers, top: top, maxPotatoRounds: maxPotatoRounds,
    tiebreakStep: tiebreakStep, standings: standings, tallyWins: tallyWins, botPlan: botPlan
  };
});
