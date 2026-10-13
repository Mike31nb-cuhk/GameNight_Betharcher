/* 谁是牛头王 / 6 nimmt! — pure game engine (no DOM).
 * UMD: browser global `NimmtEngine`, node `require('./nimmt-engine.js')`.
 * Game state is a plain JSON-serialisable object; every function that changes it mutates it in place
 * (callers clone with JSON if they need history). Randomness comes from mulberry32 streams stored in the
 * state ({s: uint32}), so a saved/cloned state continues exactly the same way.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NimmtEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_CARD = 104;
  var HAND_SIZE = 10;
  var ROW_COUNT = 4;
  var ROW_MAX = 5;               // a 列 holds at most 5 cards; the 6th takes them (规则3)
  var DEFAULT_TARGET = 66;
  var BOT_NAMES = ['小东', '小西', '小南', '小北', '阿杰', '阿美', '大胖', '学霸', '宿管'];
  var AVG_BULLS = 171 / 104;

  /* ---------------- cards ---------------- */
  // 牛头 per card, exactly as the booklet: 55 → 7; 11 的倍数 → 5; 10 的倍数 → 3; 个位数为 5 → 2; 其余 → 1.
  function bulls(n) {
    if (n === 55) return 7;
    if (n % 11 === 0) return 5;
    if (n % 10 === 0) return 3;
    if (n % 5 === 0) return 2;
    return 1;
  }
  function bullsReason(n) {
    if (n === 55) return '55既是11的倍数、又以5结尾，是唯一7个牛头的牌';
    if (n % 11 === 0) return n + '是11的倍数 → 5个牛头';
    if (n % 10 === 0) return n + '是10的倍数 → 3个牛头';
    if (n % 5 === 0) return n + '以5结尾 → 2个牛头';
    return n + '是普通牌 → 1个牛头';
  }
  function sumBulls(cards) {
    var t = 0;
    for (var i = 0; i < cards.length; i++) t += bulls(cards[i]);
    return t;
  }
  function range(lo, hi) { var a = []; for (var i = lo; i <= hi; i++) a.push(i); return a; }
  function deck(max) { return range(1, max || MAX_CARD); }

  /* ---------------- rng (mulberry32, state kept in a plain object) ---------------- */
  function rngNext(st) {
    var t = (st.s = (st.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function makeRng(seed) {
    var st = { s: (seed >>> 0) };
    var f = function () { return rngNext(st); };
    f.state = st;
    return f;
  }
  function shuffle(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function asc(a, b) { return a - b; }

  /* ---------------- rows: 规则1–4 ---------------- */
  function lastOf(row) { return row[row.length - 1]; }
  function rowBulls(row) { return sumBulls(row); }
  function cloneRows(rows) { return rows.map(function (r) { return r.slice(); }); }

  // 规则1「由小至大」+ 规则2「差异最小」: the 列 whose last card is lower than `card` with the smallest
  // difference. Returns -1 when `card` is lower than every 列's last card (规则4).
  function targetRow(rows, card) {
    var best = -1, bestDiff = Infinity;
    for (var i = 0; i < rows.length; i++) {
      var end = lastOf(rows[i]);
      if (end < card && card - end < bestDiff) { bestDiff = card - end; best = i; }
    }
    return best;
  }

  // Bot / 提示 choice for 规则4: fewest 牛头, tie → fewer cards, tie → lower last card, tie → lower index.
  function cheapestRow(rows) {
    var best = 0;
    for (var i = 1; i < rows.length; i++) {
      var a = rows[i], b = rows[best];
      var ba = rowBulls(a), bb = rowBulls(b);
      if (ba < bb || (ba === bb && (a.length < b.length || (a.length === b.length && lastOf(a) < lastOf(b))))) best = i;
    }
    return best;
  }

  // Where would `card` go and what happens, without changing anything.
  // kind: 'add' (规则1/2), 'full' (规则3 — 6th card takes the 5), 'low' (规则4 — needs a row choice).
  function previewPlacement(rows, card) {
    var t = targetRow(rows, card);
    if (t === -1) return { kind: 'low', row: -1, cheapest: cheapestRow(rows) };
    if (rows[t].length >= ROW_MAX) return { kind: 'full', row: t, bulls: rowBulls(rows[t]), taken: rows[t].slice() };
    return { kind: 'add', row: t, diff: card - lastOf(rows[t]) };
  }

  // Apply one card to the rows (mutates `rows`). `choice` is required for 规则4 (any 列 index 0–3).
  // Returns an event {card, kind, row, taken: [...], bulls}.
  function placeCard(rows, card, choice) {
    var t = targetRow(rows, card);
    var ev = { card: card, kind: 'add', row: t, taken: [], bulls: 0, end: null };
    if (t === -1) {
      if (choice === undefined || choice === null) throw new Error('规则4: card ' + card + ' needs a row choice');
      if (!(choice >= 0 && choice < rows.length) || Math.floor(choice) !== choice) throw new Error('bad row choice ' + choice);
      ev.kind = 'low'; ev.row = choice;
      ev.taken = rows[choice].slice();
      ev.bulls = rowBulls(ev.taken);
      rows[choice] = [card];
      return ev;
    }
    ev.end = lastOf(rows[t]);
    if (rows[t].length >= ROW_MAX) {
      ev.kind = 'full';
      ev.taken = rows[t].slice();
      ev.bulls = rowBulls(ev.taken);
      rows[t] = [card];
      return ev;
    }
    rows[t].push(card);
    return ev;
  }

  // Resolve one 轮 on a copy of `rows`: plays = [{player, card}], in any order — they are placed from the
  // lowest number to the highest. chooser(rowsNow, play) → row index for 规则4 (default: cheapestRow).
  // Returns {rows, events}. Used by tests and the tutorial to replay the booklet's 图1–图6.
  function resolveTrick(rows, plays, chooser) {
    var r = cloneRows(rows);
    var order = plays.slice().sort(function (a, b) { return a.card - b.card; });
    var events = [];
    for (var i = 0; i < order.length; i++) {
      var p = order[i];
      var choice;
      if (targetRow(r, p.card) === -1) {
        choice = typeof chooser === 'function' ? chooser(r, p) :
          (chooser && chooser[p.player] !== undefined ? chooser[p.player] : cheapestRow(r));
      }
      var ev = placeCard(r, p.card, choice);
      ev.player = p.player;
      events.push(ev);
    }
    return { rows: r, events: events };
  }

  /* ---------------- game ---------------- */
  function advancedAllowed(n) { return n >= 2 && n <= 6; }
  function deckSizeFor(config) { return config.advanced ? config.numPlayers * 10 + 4 : MAX_CARD; }

  function createGame(opts) {
    opts = opts || {};
    var n = opts.numPlayers || (opts.names ? opts.names.length : 4);
    if (!(n >= 2 && n <= 10)) throw new Error('6 nimmt! is for 2–10 players');
    var names = opts.names ? opts.names.slice(0, n) : ['你'].concat(BOT_NAMES.slice(0, n - 1));
    var humans = opts.humans || [0];
    var advanced = !!opts.advanced;
    if (advanced && !advancedAllowed(n)) throw new Error('进阶规则 is for 2–6 players');
    var draft = advanced && !!opts.draft;
    var endMode = opts.endMode === 'rounds' ? 'rounds' : 'target';
    var seed = (opts.seed === undefined ? Math.floor(Math.random() * 4294967296) : opts.seed) >>> 0;
    var state = {
      v: 1,
      config: {
        numPlayers: n,
        endMode: endMode,
        target: opts.target || DEFAULT_TARGET,
        rounds: opts.rounds || 3,
        advanced: advanced,
        draft: draft,
        seed: seed
      },
      round: 0, turn: 0, phase: 'setup',
      rows: [], pending: [], revealed: [], lastEvents: [],
      seen: [], rest: [], draft: null,
      players: names.map(function (name, i) {
        return { name: name, isBot: humans.indexOf(i) === -1, hand: [], pile: [], chosen: null,
          roundBulls: 0, total: 0, history: [] };
      }),
      rng: { s: seed },
      botRng: { s: (seed ^ 0x9E3779B9) >>> 0 },
      endReason: null, winners: null
    };
    startRound(state);
    return state;
  }

  function startRound(state) {
    var c = state.config;
    var n = state.players.length;
    state.round += 1;
    state.turn = 1;
    state.pending = []; state.revealed = []; state.lastEvents = []; state.seen = [];
    state.players.forEach(function (p) { p.hand = []; p.pile = []; p.chosen = null; p.roundBulls = 0; });
    var cards = shuffle(deck(deckSizeFor(c)), function () { return rngNext(state.rng); });
    if (c.draft) {
      // 进阶规则 2: all cards face up; players take turns taking 1 until everyone has 10; the 4 left start the 列.
      // The booklet doesn't say who picks first — the web version rotates the first picker each 回合.
      state.phase = 'draft';
      state.rows = [];
      state.rest = [];
      state.draft = { pool: cards.slice().sort(asc), next: (state.round - 1) % n };
      return state;
    }
    for (var i = 0; i < n; i++) state.players[i].hand = cards.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE).sort(asc);
    var k = n * HAND_SIZE;
    state.rows = [[cards[k]], [cards[k + 1]], [cards[k + 2]], [cards[k + 3]]];
    state.rest = cards.slice(k + ROW_COUNT);          // not used this 回合
    state.seen = [cards[k], cards[k + 1], cards[k + 2], cards[k + 3]];
    state.phase = 'choose';
    return state;
  }

  function draftCurrent(state) { return state.phase === 'draft' ? state.draft.next : -1; }

  function draftPick(state, p, card) {
    if (state.phase !== 'draft') throw new Error('not drafting');
    if (p !== state.draft.next) throw new Error('not player ' + p + "'s pick");
    var idx = state.draft.pool.indexOf(card);
    if (idx === -1) throw new Error('card ' + card + ' not in the pool');
    state.draft.pool.splice(idx, 1);
    var pl = state.players[p];
    pl.hand.push(card); pl.hand.sort(asc);
    var n = state.players.length;
    var everyoneFull = state.players.every(function (x) { return x.hand.length >= HAND_SIZE; });
    if (everyoneFull) {
      var left = state.draft.pool.slice().sort(asc);
      state.rows = left.map(function (c) { return [c]; });
      state.seen = left.slice();
      state.draft = null;
      state.phase = 'choose';
      return state;
    }
    var nx = (p + 1) % n;
    while (state.players[nx].hand.length >= HAND_SIZE) nx = (nx + 1) % n;
    state.draft.next = nx;
    return state;
  }

  function chooseCard(state, p, card) {
    if (state.phase !== 'choose') throw new Error('not choosing (phase ' + state.phase + ')');
    var pl = state.players[p];
    if (pl.hand.indexOf(card) === -1) throw new Error('card ' + card + ' is not in ' + pl.name + "'s hand");
    pl.chosen = card;
    return state;
  }
  function allChosen(state) { return state.players.every(function (p) { return p.chosen !== null; }); }

  function chooseBots(state) {
    state.players.forEach(function (p, i) { if (p.isBot && p.chosen === null) p.chosen = botChooseCard(state, i); });
    return state;
  }

  // Everyone flips at once; cards wait above the table sorted ascending.
  function reveal(state) {
    if (state.phase !== 'choose') throw new Error('not choosing');
    if (!allChosen(state)) throw new Error('not everyone has chosen');
    var plays = state.players.map(function (p, i) {
      var c = p.chosen;
      p.hand.splice(p.hand.indexOf(c), 1);
      p.chosen = null;
      return { player: i, card: c };
    }).sort(function (a, b) { return a.card - b.card; });
    state.pending = plays.slice();
    state.revealed = plays.slice();
    state.lastEvents = [];
    plays.forEach(function (x) { state.seen.push(x.card); });
    state.phase = 'resolve';
    return state;
  }

  function peekNext(state) {
    if (state.phase !== 'resolve' || !state.pending.length) return null;
    var nx = state.pending[0];
    var pv = previewPlacement(state.rows, nx.card);
    return { player: nx.player, card: nx.card, kind: pv.kind, row: pv.row,
      needsChoice: pv.kind === 'low' && !state.players[nx.player].isBot };
  }

  // Place the lowest pending card. For a human's 规则4 card `choice` (0–3) is required; bots choose by
  // fewest 牛头. Returns the event; when the 轮 is over moves on (next 轮 / 回合结束 / 游戏结束).
  function resolveNext(state, choice) {
    if (state.phase !== 'resolve') throw new Error('nothing to resolve');
    var nx = state.pending[0];
    var pl = state.players[nx.player];
    var c = choice;
    if (targetRow(state.rows, nx.card) === -1) {
      if (c === undefined || c === null) {
        if (!pl.isBot) throw new Error('规则4: ' + pl.name + ' must choose a row for ' + nx.card);
        c = botChooseRow(state.rows);
      }
    } else c = undefined;
    var ev = placeCard(state.rows, nx.card, c);
    ev.player = nx.player;
    if (ev.taken.length) {
      for (var i = 0; i < ev.taken.length; i++) pl.pile.push(ev.taken[i]);   // 牛头堆 — never the hand
      pl.roundBulls += ev.bulls;
    }
    state.pending.shift();
    state.lastEvents.push(ev);
    if (!state.pending.length) endTurn(state);
    return ev;
  }

  function endTurn(state) {
    var handsEmpty = state.players.every(function (p) { return p.hand.length === 0; });
    if (!handsEmpty) {
      state.turn += 1;
      state.phase = 'choose';
      return state;
    }
    // 回合结束: everyone counts their 牛头堆.
    state.players.forEach(function (p) {
      p.roundBulls = sumBulls(p.pile);
      p.total += p.roundBulls;
      p.history.push(p.roundBulls);
    });
    var c = state.config;
    var maxTotal = Math.max.apply(null, state.players.map(function (p) { return p.total; }));
    if (c.endMode === 'target' && maxTotal >= c.target) {
      state.endReason = { type: 'target', target: c.target,
        who: state.players.map(function (p, i) { return p.total >= c.target ? i : -1; }).filter(function (i) { return i >= 0; }) };
      finishGame(state);
    } else if (c.endMode === 'rounds' && state.round >= c.rounds) {
      state.endReason = { type: 'rounds', rounds: c.rounds };
      finishGame(state);
    } else {
      state.phase = 'roundEnd';
    }
    return state;
  }

  function finishGame(state) {
    var min = Math.min.apply(null, state.players.map(function (p) { return p.total; }));
    state.winners = state.players.map(function (p, i) { return p.total === min ? i : -1; }).filter(function (i) { return i >= 0; });
    state.phase = 'gameOver';
  }

  function nextRound(state) {
    if (state.phase !== 'roundEnd') throw new Error('round not over');
    return startRound(state);
  }

  // Ranking: fewest 牛头 first; equal totals share a rank (and a win).
  function results(state) {
    var list = state.players.map(function (p, i) {
      return { player: i, name: p.name, total: p.total, history: p.history.slice(), isBot: p.isBot };
    });
    list.sort(function (a, b) { return a.total - b.total || a.player - b.player; });
    var rank = 0, prev = null;
    list.forEach(function (x, i) { if (x.total !== prev) { rank = i + 1; prev = x.total; } x.rank = rank; });
    return list;
  }

  /* ---------------- bots ---------------- */
  function botChooseRow(rows) { return cheapestRow(rows); }

  function binomTailAtLeast(n, p, k) {
    if (k <= 0) return 1;
    if (k > n) return 0;
    var below = 0, coef = 1;
    for (var i = 0; i < k; i++) {
      if (i > 0) coef = coef * (n - i + 1) / i;
      below += coef * Math.pow(p, i) * Math.pow(1 - p, n - i);
    }
    return Math.max(0, Math.min(1, 1 - below));
  }

  // Cards a player can't see: not in their hand, not on the table / revealed earlier this 回合.
  function unseenFor(state, p) {
    var known = {};
    state.players[p].hand.forEach(function (c) { known[c] = 1; });
    state.seen.forEach(function (c) { known[c] = 1; });
    state.rows.forEach(function (r) { r.forEach(function (c) { known[c] = 1; }); });
    var out = [];
    var max = deckSizeFor(state.config);
    for (var c = 1; c <= max; c++) if (!known[c]) out.push(c);
    return out;
  }

  // Expected 牛头 for playing `card` now, from player p's point of view (spec §3.4).
  function expectedPenalty(state, p, card) {
    var rows = state.rows;
    var unseen = unseenFor(state, p);
    var opp = state.players.length - 1;
    var prob = unseen.length ? Math.min(1, opp / unseen.length) : 0;   // chance a given unseen card is played this 轮
    var t = targetRow(rows, card);
    if (t === -1) {
      // 规则4: cost = cheapest 列, unless someone plays even lower first (then we'd follow their card).
      var lower = 0;
      for (var i = 0; i < unseen.length; i++) if (unseen[i] < card) lower++;
      var pLower = 1 - Math.pow(1 - prob, lower);
      return rowBulls(rows[cheapestRow(rows)]) * (1 - pLower) + 0.15;
    }
    var row = rows[t];
    var end = lastOf(row);
    var gap = 0;
    for (var j = 0; j < unseen.length; j++) if (unseen[j] > end && unseen[j] < card) gap++;
    var need = ROW_MAX - row.length;      // other cards that must land there first to make ours the 6th
    var risk = binomTailAtLeast(gap, prob, need);
    var takeCost = rowBulls(row) + need * AVG_BULLS;
    return risk * takeCost + (card - end) * 0.004;   // tiny preference for snug fits
  }

  function botChooseCard(state, p) {
    var hand = state.players[p].hand;
    if (!hand.length) throw new Error('empty hand');
    var best = hand[0], bestCost = Infinity;
    for (var i = 0; i < hand.length; i++) {
      var cost = expectedPenalty(state, p, hand[i]) + (rngNext(state.botRng) - 0.5) * 0.7;
      if (cost < bestCost) { bestCost = cost; best = hand[i]; }
    }
    return best;
  }

  // Draft heuristic: like low cards (escape), cards next to ones already held, dislike carrying the 55-type
  // cards a little; plus noise so bots differ.
  function botDraftPick(state, p) {
    var pool = state.draft.pool;
    var hand = state.players[p].hand;
    var best = pool[0], bestScore = -Infinity;
    for (var i = 0; i < pool.length; i++) {
      var c = pool[i], score = 0;
      if (c <= 6) score += 0.6;
      for (var j = 0; j < hand.length; j++) { var d = Math.abs(hand[j] - c); if (d === 1) score += 0.5; else if (d === 2) score += 0.25; }
      score -= (bulls(c) - 1) * 0.08;
      score += rngNext(state.botRng) * 0.9;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  // Convenience for headless simulation / tests: let bots (and optionally a scripted human) finish the game.
  function autoPlayRound(state, humanPolicy) {
    var guard = 0;
    while (state.phase === 'draft' || state.phase === 'choose' || state.phase === 'resolve') {
      if (++guard > 5000) throw new Error('autoPlayRound runaway');
      if (state.phase === 'draft') {
        var d = state.draft.next;
        var pick = state.players[d].isBot ? botDraftPick(state, d) : (humanPolicy && humanPolicy.draft ? humanPolicy.draft(state, d) : botDraftPick(state, d));
        draftPick(state, d, pick);
      } else if (state.phase === 'choose') {
        state.players.forEach(function (pl, i) {
          if (pl.chosen === null) pl.chosen = (!pl.isBot && humanPolicy && humanPolicy.card) ? humanPolicy.card(state, i) : botChooseCard(state, i);
        });
        reveal(state);
      } else {
        var nx = peekNext(state);
        var ch;
        if (nx.needsChoice) ch = humanPolicy && humanPolicy.row ? humanPolicy.row(state, nx.player) : cheapestRow(state.rows);
        resolveNext(state, ch);
      }
    }
    return state;
  }

  return {
    MAX_CARD: MAX_CARD, HAND_SIZE: HAND_SIZE, ROW_COUNT: ROW_COUNT, ROW_MAX: ROW_MAX,
    DEFAULT_TARGET: DEFAULT_TARGET, BOT_NAMES: BOT_NAMES,
    bulls: bulls, bullsReason: bullsReason, sumBulls: sumBulls, deck: deck, range: range,
    makeRng: makeRng, rngNext: rngNext, shuffle: shuffle,
    targetRow: targetRow, cheapestRow: cheapestRow, rowBulls: rowBulls, previewPlacement: previewPlacement,
    placeCard: placeCard, resolveTrick: resolveTrick, cloneRows: cloneRows,
    advancedAllowed: advancedAllowed, deckSizeFor: deckSizeFor,
    createGame: createGame, startRound: startRound, nextRound: nextRound,
    draftCurrent: draftCurrent, draftPick: draftPick, botDraftPick: botDraftPick,
    chooseCard: chooseCard, allChosen: allChosen, chooseBots: chooseBots, reveal: reveal,
    peekNext: peekNext, resolveNext: resolveNext, results: results,
    botChooseRow: botChooseRow, botChooseCard: botChooseCard, expectedPenalty: expectedPenalty,
    unseenFor: unseenFor, binomTailAtLeast: binomTailAtLeast, autoPlayRound: autoPlayRound
  };
});
