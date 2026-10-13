/* Sushi Go! 规则引擎 — 纯逻辑，无 DOM。
 * 浏览器里是全局 SushiEngine，node 里 require() 得到同一个对象。
 * 状态对象全部可 JSON 序列化（随机数种子也存在 state.rng 里）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SushiEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- 卡牌
  var TYPES = {
    tempura:    { name: '天妇罗',   en: 'Tempura',        count: 14, kind: 'tempura' },
    sashimi:    { name: '刺身',     en: 'Sashimi',        count: 14, kind: 'sashimi' },
    dumpling:   { name: '煎饺',     en: 'Dumpling',       count: 14, kind: 'dumpling' },
    maki2:      { name: '寿司卷',   en: 'Maki Roll',      count: 12, kind: 'maki', icons: 2 },
    maki3:      { name: '寿司卷',   en: 'Maki Roll',      count: 8,  kind: 'maki', icons: 3 },
    maki1:      { name: '寿司卷',   en: 'Maki Roll',      count: 6,  kind: 'maki', icons: 1 },
    salmon:     { name: '鲑鱼手握', en: 'Salmon Nigiri',  count: 10, kind: 'nigiri', value: 2 },
    squid:      { name: '鱿鱼手握', en: 'Squid Nigiri',   count: 5,  kind: 'nigiri', value: 3 },
    egg:        { name: '鸡蛋手握', en: 'Egg Nigiri',     count: 5,  kind: 'nigiri', value: 1 },
    pudding:    { name: '布丁',     en: 'Pudding',        count: 10, kind: 'pudding' },
    wasabi:     { name: '芥末',     en: 'Wasabi',         count: 6,  kind: 'wasabi' },
    chopsticks: { name: '筷子',     en: 'Chopsticks',     count: 4,  kind: 'chopsticks' }
  };
  var TYPE_ORDER = ['tempura', 'sashimi', 'dumpling', 'maki2', 'maki3', 'maki1',
    'salmon', 'squid', 'egg', 'pudding', 'wasabi', 'chopsticks'];
  var HAND_SIZE = { 2: 10, 3: 9, 4: 8, 5: 7 };
  var DUMPLING_PTS = [0, 1, 3, 6, 10, 15];
  var BOT_NAMES = ['小东', '小西', '小南', '小北'];
  var ROUNDS = 3;

  function isNigiri(t) { return TYPES[t] && TYPES[t].kind === 'nigiri'; }
  function isMaki(t) { return TYPES[t] && TYPES[t].kind === 'maki'; }
  function makiIcons(t) { return isMaki(t) ? TYPES[t].icons : 0; }
  function nigiriValue(t) { return isNigiri(t) ? TYPES[t].value : 0; }

  // ---------------------------------------------------------------- 随机数 (mulberry32)
  function rand(state) {
    var a = state.rng | 0;
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    state.rng = a;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function makeRng(seed) {
    var s = { rng: seed >>> 0 };
    return function () { return rand(s); };
  }
  function shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // ---------------------------------------------------------------- 牌堆
  function makeDeck() {
    var deck = [], id = 0;
    TYPE_ORDER.forEach(function (t) {
      for (var k = 0; k < TYPES[t].count; k++) deck.push({ id: id++, t: t });
    });
    return deck;
  }

  function passDir(state) {
    // +1 = 传给左边（座位号 +1），-1 = 传给右边。两边传递变体：第 2 回合向右。
    return state.options && state.options.alternate && state.round === 2 ? -1 : 1;
  }

  function newPlayer(name) {
    return { name: name, hand: [], table: [], puddings: [], pick: null, rounds: [], puddingScore: 0, total: 0 };
  }

  /* opts: { players: 2..5 | names: [...], seed, alternate, stack: [type...] (放到抽牌堆最上面，测试用) } */
  function newGame(opts) {
    opts = opts || {};
    var n = opts.names ? opts.names.length : (opts.players || 4);
    if (!(n >= 2 && n <= 5)) throw new Error('Sushi Go! 需要 2–5 名玩家');
    var names = opts.names ? opts.names.slice() : ['你'].concat(BOT_NAMES).slice(0, n);
    var seed = opts.seed != null ? (opts.seed >>> 0) : ((Math.random() * 4294967296) >>> 0);
    var state = {
      v: 1, seed: seed, rng: seed, n: n,
      options: { alternate: !!opts.alternate },
      handSize: HAND_SIZE[n], round: 0, turn: 0, phase: 'setup',
      deck: [], discard: [], removed: [],
      players: names.map(newPlayer),
      last: null, result: null
    };
    var deck = makeDeck();
    shuffle(deck, function () { return rand(state); });
    if (opts.stack && opts.stack.length) {
      var top = [];
      opts.stack.forEach(function (t) {
        var idx = -1;
        for (var i = 0; i < deck.length; i++) if (deck[i].t === t) { idx = i; break; }
        if (idx < 0) throw new Error('stack: 没有更多 ' + t);
        top.push(deck.splice(idx, 1)[0]);
      });
      deck = top.concat(deck);
    }
    state.deck = deck;
    startRound(state);
    return state;
  }

  /* 教学用：直接摆出一个局面。spec: { names, hands:[[type]], tables:[[type]], puddings:[n],
     round, turn, totals:[n], deck:[type], alternate } —— 牌不必符合 108 张的配比。 */
  function scenario(spec) {
    var names = spec.names || ['你', '小东', '小西'];
    var n = names.length;
    var state = {
      v: 1, seed: spec.seed || 1, rng: spec.seed || 1, n: n,
      options: { alternate: !!spec.alternate, scenario: true },
      handSize: spec.handSize || (spec.hands && spec.hands[0] ? spec.hands[0].length : 0),
      round: spec.round || 1, turn: spec.turn || 1, phase: 'pick',
      deck: [], discard: [], removed: [],
      players: names.map(newPlayer), last: null, result: null
    };
    var id = 1000;
    function mk(t) { if (!TYPES[t]) throw new Error('unknown type ' + t); return { id: id++, t: t }; }
    state.players.forEach(function (p, i) {
      p.hand = ((spec.hands && spec.hands[i]) || []).map(mk);
      ((spec.tables && spec.tables[i]) || []).forEach(function (t) { placeCard(p.table, mk(t)); });
      var pc = (spec.puddings && spec.puddings[i]) || 0;
      for (var k = 0; k < pc; k++) p.puddings.push(mk('pudding'));
      if (spec.totals) p.total = spec.totals[i] || 0;
    });
    state.deck = (spec.deck || []).map(mk);
    if (spec.phase) state.phase = spec.phase;
    return state;
  }

  function startRound(state) {
    state.round += 1;
    state.turn = 1;
    var need = state.handSize * state.n;
    if (state.deck.length < need) throw new Error('抽牌堆不够发牌');
    state.players.forEach(function (p) {
      p.hand = state.deck.splice(0, state.handSize);
      p.pick = null;
    });
    state.phase = 'pick';
    return state;
  }

  // ---------------------------------------------------------------- 出牌
  function hasChopsticks(player) {
    for (var i = 0; i < player.table.length; i++) if (player.table[i].t === 'chopsticks') return true;
    return false;
  }
  function canUseChopsticks(state, p) {
    var pl = state.players[p];
    return state.phase === 'pick' && pl.hand.length >= 2 && hasChopsticks(pl);
  }
  function validatePick(state, p, ids) {
    if (state.phase !== 'pick') return 'not-pick-phase';
    var pl = state.players[p];
    if (!pl) return 'no-player';
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 2) return 'bad-count';
    if (ids.length === 2) {
      if (ids[0] === ids[1]) return 'same-card';
      if (!hasChopsticks(pl)) return 'no-chopsticks';
      if (pl.hand.length < 2) return 'hand-too-small';
    }
    for (var i = 0; i < ids.length; i++) {
      var found = false;
      for (var j = 0; j < pl.hand.length; j++) if (pl.hand[j].id === ids[i]) found = true;
      if (!found) return 'not-in-hand';
    }
    return null;
  }
  function setPick(state, p, ids) {
    var err = validatePick(state, p, ids);
    if (err) throw new Error(err);
    state.players[p].pick = ids.slice();
    return state;
  }
  function clearPick(state, p) { state.players[p].pick = null; return state; }
  function allPicked(state) {
    return state.players.every(function (p) { return p.pick && p.pick.length; });
  }

  /* 把一张牌放到桌面上。手握会放到最早的、还空着的芥末上。返回放到的芥末 id 或 null。 */
  function placeCard(table, card) {
    var c = { id: card.id, t: card.t };
    var onW = null;
    if (isNigiri(c.t)) {
      for (var i = 0; i < table.length; i++) {
        if (table[i].t === 'wasabi' && table[i].n == null) { table[i].n = c.id; c.w = table[i].id; onW = table[i].id; break; }
      }
    }
    if (c.t === 'wasabi') c.n = null;
    table.push(c);
    return onW;
  }

  /* 第 1 步：所有人同时翻开。opts.deferChopsticks = true 时，用过的筷子先留在桌上（教程逐步演示用），
     之后必须调用 returnChopsticks()。 */
  function resolvePicks(state, opts) {
    opts = opts || {};
    if (state.phase !== 'pick') throw new Error('现在不是选牌阶段');
    if (!allPicked(state)) throw new Error('还有人没选好');
    var plays = state.players.map(function (pl, p) {
      var ids = pl.pick;
      var cards = ids.map(function (id) {
        for (var j = 0; j < pl.hand.length; j++) if (pl.hand[j].id === id) return pl.hand.splice(j, 1)[0];
        throw new Error('not-in-hand');
      });
      var chop = null;
      if (ids.length === 2) {
        // 先拿走「之前就在桌上」的那双筷子（这一轮刚拿的筷子不能当轮使用）
        for (var k = 0; k < pl.table.length; k++) {
          if (pl.table[k].t === 'chopsticks') { chop = pl.table[k]; break; }
        }
        if (!chop) throw new Error('no-chopsticks');
        if (!opts.deferChopsticks) {
          pl.table.splice(pl.table.indexOf(chop), 1);
          pl.hand.push({ id: chop.id, t: chop.t });
        } else {
          chop.pendingReturn = true;
        }
      }
      var onWasabi = cards.map(function (c) { return placeCard(pl.table, c); });
      pl.pick = null;
      return { p: p, cards: cards.map(function (c) { return { id: c.id, t: c.t }; }), onWasabi: onWasabi, chopsticks: chop ? chop.id : null };
    });
    state.phase = 'pass';
    state.last = { round: state.round, turn: state.turn, plays: plays, dir: passDir(state) };
    return state.last;
  }

  function returnChopsticks(state, p) {
    var pl = state.players[p];
    for (var k = 0; k < pl.table.length; k++) {
      if (pl.table[k].pendingReturn) {
        var c = pl.table.splice(k, 1)[0];
        pl.hand.push({ id: c.id, t: c.t });
        return c.id;
      }
    }
    return null;
  }

  /* 第 2 步：把剩下的手牌传给下一位。手牌出完 → 回合结束计分。 */
  function passHands(state) {
    if (state.phase !== 'pass') throw new Error('现在不是传牌阶段');
    state.players.forEach(function (pl, p) { while (returnChopsticks(state, p) != null) { /* 补上没放回的筷子 */ } });
    var n = state.n, dir = passDir(state);
    var hands = state.players.map(function (pl) { return pl.hand; });
    var from = [];
    state.players.forEach(function (pl, i) {
      var src = ((i - dir) % n + n) % n;
      pl.hand = hands[src];
      from.push(src);
    });
    if (state.last) state.last.from = from;
    if (state.players.every(function (pl) { return pl.hand.length === 0; })) {
      endRound(state);
    } else {
      state.turn += 1;
      state.phase = 'pick';
    }
    return state;
  }

  function reveal(state) {
    var info = resolvePicks(state);
    passHands(state);
    return info;
  }

  // ---------------------------------------------------------------- 计分
  function summarize(table) {
    var s = { tempura: 0, sashimi: 0, dumpling: 0, makiIcons: 0, makiCards: 0, nigiri: [], wasabi: 0, wasabiOpen: 0,
      chopsticks: 0, pudding: 0 };
    table.forEach(function (c) {
      var t = c.t;
      if (t === 'tempura') s.tempura++;
      else if (t === 'sashimi') s.sashimi++;
      else if (t === 'dumpling') s.dumpling++;
      else if (isMaki(t)) { s.makiIcons += makiIcons(t); s.makiCards++; }
      else if (isNigiri(t)) s.nigiri.push({ id: c.id, t: t, onWasabi: c.w != null });
      else if (t === 'wasabi') { s.wasabi++; if (c.n == null) s.wasabiOpen++; }
      else if (t === 'chopsticks') s.chopsticks++;
      else if (t === 'pudding') s.pudding++;
    });
    return s;
  }
  function scoreTempura(n) { return Math.floor(n / 2) * 5; }
  function scoreSashimi(n) { return Math.floor(n / 3) * 10; }
  function scoreDumplings(n) { return DUMPLING_PTS[Math.min(n, 5)]; }
  function scoreNigiriList(list) {
    return list.reduce(function (a, x) { return a + nigiriValue(x.t) * (x.onWasabi ? 3 : 1); }, 0);
  }

  /* 寿司卷：最多 6 分（并列平分，舍去余数，且不再给第二名）；第二多 3 分（并列平分）。0 个标记不参与。 */
  function scoreMaki(icons) {
    var pts = icons.map(function () { return 0; });
    var pos = icons.filter(function (x) { return x > 0; });
    if (!pos.length) return pts;
    var max = Math.max.apply(null, pos);
    var firsts = [];
    icons.forEach(function (x, i) { if (x === max) firsts.push(i); });
    firsts.forEach(function (i) { pts[i] = Math.floor(6 / firsts.length); });
    if (firsts.length === 1) {
      var rest = pos.filter(function (x) { return x < max; });
      if (rest.length) {
        var second = Math.max.apply(null, rest);
        var seconds = [];
        icons.forEach(function (x, i) { if (x === second) seconds.push(i); });
        seconds.forEach(function (i) { pts[i] = Math.floor(3 / seconds.length); });
      }
    }
    return pts;
  }

  /* 布丁（游戏结束）：最多 +6（并列平分），最少 −6（并列平分，0 张也算）。2 人不扣分。全部相同则都不得分。 */
  function scorePudding(counts) {
    var n = counts.length;
    var pts = counts.map(function () { return 0; });
    var max = Math.max.apply(null, counts), min = Math.min.apply(null, counts);
    if (max === min) return pts;
    var most = [], fewest = [];
    counts.forEach(function (c, i) { if (c === max) most.push(i); if (c === min) fewest.push(i); });
    most.forEach(function (i) { pts[i] += Math.floor(6 / most.length); });
    if (n > 2) fewest.forEach(function (i) { pts[i] -= Math.floor(6 / fewest.length); });
    return pts;
  }

  function scoreTables(tables) {
    var sums = tables.map(summarize);
    var maki = scoreMaki(sums.map(function (s) { return s.makiIcons; }));
    return sums.map(function (s, i) {
      var r = {
        makiIcons: s.makiIcons, maki: maki[i],
        tempuraCount: s.tempura, tempura: scoreTempura(s.tempura),
        sashimiCount: s.sashimi, sashimi: scoreSashimi(s.sashimi),
        dumplingCount: s.dumpling, dumpling: scoreDumplings(s.dumpling),
        nigiriList: s.nigiri, nigiri: scoreNigiriList(s.nigiri),
        puddingCount: s.pudding, wasabiOpen: s.wasabiOpen, chopsticks: s.chopsticks
      };
      r.total = r.maki + r.tempura + r.sashimi + r.dumpling + r.nigiri;
      return r;
    });
  }

  function endRound(state) {
    var res = scoreTables(state.players.map(function (p) { return p.table; }));
    state.players.forEach(function (p, i) {
      res[i].round = state.round;
      p.rounds.push(res[i]);
      p.total += res[i].total;
    });
    state.phase = 'roundEnd';
    state.roundResult = res;
    return res;
  }

  function puddingCount(player) {
    return player.puddings.length + player.table.filter(function (c) { return c.t === 'pudding'; }).length;
  }

  /* 回合结束后：收走桌面（布丁留下），发下一回合；第 3 回合后进入游戏结束。 */
  function advance(state) {
    if (state.phase !== 'roundEnd') throw new Error('现在不是回合结束');
    state.players.forEach(function (p) {
      p.table.forEach(function (c) {
        var card = { id: c.id, t: c.t };
        if (c.t === 'pudding') p.puddings.push(card); else state.discard.push(card);
      });
      p.table = [];
    });
    state.roundResult = null;
    if (state.round < ROUNDS) {
      startRound(state);
    } else {
      finishGame(state);
    }
    return state;
  }

  function finishGame(state) {
    state.removed = state.deck;   // 剩下的抽牌堆移出游戏
    state.deck = [];
    var counts = state.players.map(function (p) { return p.puddings.length; });
    var pp = scorePudding(counts);
    state.players.forEach(function (p, i) { p.puddingScore = pp[i]; p.total += pp[i]; });
    state.phase = 'gameOver';
    state.result = ranking(state);
    return state.result;
  }

  /* 名次：总分高者胜；同分比布丁多少；再相同则并列。 */
  function ranking(state) {
    var rows = state.players.map(function (p, i) {
      return { p: i, name: p.name, total: p.total, puddings: puddingCount(p) };
    });
    rows.sort(function (a, b) { return b.total - a.total || b.puddings - a.puddings || a.p - b.p; });
    var rank = 0, prev = null;
    rows.forEach(function (r, k) {
      if (!prev || r.total !== prev.total || r.puddings !== prev.puddings) rank = k + 1;
      r.rank = rank; prev = r;
    });
    var winners = rows.filter(function (r) { return r.rank === 1; }).map(function (r) { return r.p; });
    var topTotal = rows[0].total;
    var tiedOnTotal = rows.filter(function (r) { return r.total === topTotal; }).length > 1;
    return { rows: rows, winners: winners, tieBreakUsed: tiedOnTotal, sharedWin: winners.length > 1 };
  }

  // ---------------------------------------------------------------- 预览（教学 & 教练解说用）
  /* 把一张牌加到桌面后，这名玩家本回合分数立刻变化多少（寿司卷按当前标记数相对比较）。 */
  function cardGain(state, p, type) {
    var tables = state.players.map(function (pl) { return pl.table.map(function (c) { return { id: c.id, t: c.t, w: c.w, n: c.n }; }); });
    var before = scoreTables(tables)[p].total;
    placeCard(tables[p], { id: -1, t: type });
    var after = scoreTables(tables)[p].total;
    return after - before;
  }
  function roundPreview(state) {
    return scoreTables(state.players.map(function (pl) { return pl.table; }));
  }

  // ---------------------------------------------------------------- 机器人
  function addToSummary(s, t) {
    var o = clone(s);
    if (t === 'tempura') o.tempura++;
    else if (t === 'sashimi') o.sashimi++;
    else if (t === 'dumpling') o.dumpling++;
    else if (isMaki(t)) { o.makiIcons += makiIcons(t); o.makiCards++; }
    else if (isNigiri(t)) { var on = o.wasabiOpen > 0; if (on) o.wasabiOpen--; o.nigiri.push({ t: t, onWasabi: on }); }
    else if (t === 'wasabi') { o.wasabi++; o.wasabiOpen++; }
    else if (t === 'chopsticks') o.chopsticks++;
    else if (t === 'pudding') o.pudding++;
    return o;
  }

  function botContext(state, p) {
    var pl = state.players[p];
    var opps = [], oppP = [];
    state.players.forEach(function (o, i) {
      if (i === p) return;
      opps.push(summarize(o.table));
      oppP.push(puddingCount(o));
    });
    return { me: summarize(pl.table), opps: opps, oppPuddings: oppP, myPuddings: puddingCount(pl),
      turnsLeft: pl.hand.length, round: state.round, n: state.n };
  }

  /* 一张牌对机器人的启发式价值（不是精确期望，故意“像人”而不是最优）。 */
  function cardValue(t, me, ctx) {
    var after = ctx.turnsLeft - 1;   // 这张之后还能再拿几张
    switch (t) {
      case 'tempura':
        if (me.tempura % 2 === 1) return 5;
        return after >= 4 ? 2.5 : after >= 2 ? 1.8 : after >= 1 ? 0.8 : 0;
      case 'sashimi': {
        var m = me.sashimi % 3;
        if (m === 2) return 10;
        if (m === 1) return after >= 3 ? 4.5 : after === 2 ? 3 : after === 1 ? 1.5 : 0;
        return after >= 5 ? 3.3 : after >= 3 ? 2.2 : after === 2 ? 0.8 : 0;
      }
      case 'dumpling': {
        var d = me.dumpling;
        if (d >= 5) return 0;
        return (DUMPLING_PTS[d + 1] - DUMPLING_PTS[d]) + (after >= 2 && d + 1 < 5 ? 0.6 : 0);
      }
      case 'maki1': case 'maki2': case 'maki3': {
        var k = makiIcons(t);
        var icons = [me.makiIcons].concat(ctx.opps.map(function (o) { return o.makiIcons; }));
        var before = scoreMaki(icons)[0];
        icons[0] += k;
        var delta = scoreMaki(icons)[0] - before;
        if (after === 0) return delta;
        return 0.5 * delta + 0.9 * k * Math.min(1, after / 3 + 0.4);
      }
      case 'salmon': case 'squid': case 'egg':
        return nigiriValue(t) * (me.wasabiOpen > 0 ? 3 : 1);
      case 'wasabi': {
        if (after === 0) return 0;
        var w = after >= 5 ? 4.2 : after >= 3 ? 3 : 1.2;
        return me.wasabiOpen > 0 ? w * 0.35 : w;
      }
      case 'pudding': {
        if (ctx.round < 3) return ctx.round === 1 ? 1.6 : 2.0;
        var maxO = Math.max.apply(null, ctx.oppPuddings), minO = Math.min.apply(null, ctx.oppPuddings);
        var v = 2.2;
        if (ctx.myPuddings <= maxO) v += 1.2;              // 有机会追上「最多」
        if (ctx.n > 2 && ctx.myPuddings <= minO) v += 1.4; // 避免「最少」扣 6 分
        return v;
      }
      case 'chopsticks':
        if (me.chopsticks > 0) return 0.2;
        return after >= 6 ? 3 : after >= 4 ? 2 : after >= 3 ? 1 : 0.1;
    }
    return 0;
  }

  /* 机器人选牌：返回 [cardId] 或用筷子时 [第一张, 第二张]。rnd 默认用 state 里的种子。 */
  function botPick(state, p, rnd) {
    rnd = rnd || function () { return rand(state); };
    var pl = state.players[p];
    var hand = pl.hand;
    if (!hand.length) throw new Error('empty hand');
    if (hand.length === 1) return [hand[0].id];
    var ctx = botContext(state, p);
    var noise = {};
    hand.forEach(function (c) { if (noise[c.t] == null) noise[c.t] = (rnd() - 0.5) * 1.2; });
    var best = null;
    hand.forEach(function (c) {
      var v = cardValue(c.t, ctx.me, ctx) + noise[c.t];
      if (!best || v > best.v) best = { c: c, v: v };
    });
    if (canUseChopsticks(state, p)) {
      var pair = null;
      hand.forEach(function (a) {
        var va = cardValue(a.t, ctx.me, ctx) + noise[a.t];
        var meA = addToSummary(ctx.me, a.t);
        hand.forEach(function (b) {
          if (b.id === a.id) return;
          var v = va + cardValue(b.t, meA, ctx) + noise[b.t];
          if (!pair || v > pair.v) pair = { a: a, b: b, v: v };
        });
      });
      if (pair && pair.v - best.v >= 3.2) return [pair.a.id, pair.b.id];
    }
    return [best.c.id];
  }

  /* 让所有机器人选牌（skip 里的座位不动）。 */
  function botsPick(state, skip) {
    state.players.forEach(function (pl, p) {
      if (skip && skip.indexOf(p) >= 0) return;
      if (!pl.pick) setPick(state, p, botPick(state, p));
    });
    return state;
  }

  return {
    TYPES: TYPES, TYPE_ORDER: TYPE_ORDER, HAND_SIZE: HAND_SIZE, DUMPLING_PTS: DUMPLING_PTS,
    BOT_NAMES: BOT_NAMES, ROUNDS: ROUNDS,
    isNigiri: isNigiri, isMaki: isMaki, makiIcons: makiIcons, nigiriValue: nigiriValue,
    rand: rand, makeRng: makeRng, shuffle: shuffle, clone: clone,
    makeDeck: makeDeck, newGame: newGame, scenario: scenario, startRound: startRound, passDir: passDir,
    hasChopsticks: hasChopsticks, canUseChopsticks: canUseChopsticks, validatePick: validatePick,
    setPick: setPick, clearPick: clearPick, allPicked: allPicked, placeCard: placeCard,
    resolvePicks: resolvePicks, returnChopsticks: returnChopsticks, passHands: passHands, reveal: reveal,
    summarize: summarize, scoreTempura: scoreTempura, scoreSashimi: scoreSashimi, scoreDumplings: scoreDumplings,
    scoreNigiriList: scoreNigiriList, scoreMaki: scoreMaki, scorePudding: scorePudding, scoreTables: scoreTables,
    endRound: endRound, advance: advance, finishGame: finishGame, ranking: ranking, puddingCount: puddingCount,
    cardGain: cardGain, roundPreview: roundPreview,
    cardValue: cardValue, botContext: botContext, botPick: botPick, botsPick: botsPick
  };
});
