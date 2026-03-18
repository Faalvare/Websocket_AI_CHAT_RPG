const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

// ── CLASES ───────────────────────────────────────────────────────────────────

const CLASSES = {
  warrior: {
    name: "Guerrero", emoji: "⚔️",
    baseStats: { hp: 120, atk: 15, def: 12, mag: 3, spd: 6, crit: 10 },
    skills: {
      slash:       { name: "Tajo",             desc: "ATK × 1.2",                       damage: s => Math.floor(s.atk * 1.2) },
      shield_bash: { name: "Golpe de Escudo",   desc: "ATK × 0.8 + aturde 1 turno",     damage: s => Math.floor(s.atk * 0.8), effect: "stun" },
      berserk:     { name: "Frenesí Berserker", desc: "ATK × 2.0 (solo si HP < 30%)",   damage: s => Math.floor(s.atk * 2.0), condition: p => p.hp < p.maxHp * 0.3 },
    },
  },
  mage: {
    name: "Mago", emoji: "🔮",
    baseStats: { hp: 70, atk: 6, def: 4, mag: 18, spd: 8, crit: 15 },
    skills: {
      fireball:     { name: "Bola de Fuego",   desc: "MAG × 1.5",                              damage: s => Math.floor(s.mag * 1.5) },
      ice_shield:   { name: "Escudo de Hielo", desc: "+DEF MAG×0.5 por 2 turnos (self)",        effect: "shield",  value: s => Math.floor(s.mag * 0.5) },
      arcane_burst: { name: "Explosión Arcana",desc: "MAG × 2.0 pero −10 MAG 1 turno",          damage: s => Math.floor(s.mag * 2.0), effect: "arcane_exhaust" },
    },
  },
  rogue: {
    name: "Pícaro", emoji: "🗡️",
    baseStats: { hp: 85, atk: 12, def: 6, mag: 4, spd: 14, crit: 25 },
    skills: {
      backstab:   { name: "Apuñalar",      desc: "ATK×1.5 + SPD×0.3, ignora DEF",    damage: s => Math.floor(s.atk * 1.5 + s.spd * 0.3), penetrate: true },
      smoke_bomb: { name: "Bomba de Humo", desc: "Esquiva el próximo ataque",          effect: "dodge" },
      poison:     { name: "Golpe Tóxico",  desc: "ATK×0.8 + veneno 3 turnos",         damage: s => Math.floor(s.atk * 0.8), effect: "poison" },
    },
  },
  cleric: {
    name: "Clérigo", emoji: "✨",
    baseStats: { hp: 90, atk: 8, def: 9, mag: 14, spd: 7, crit: 8 },
    skills: {
      holy_strike: { name: "Golpe Sagrado", desc: "(ATK + MAG) × 0.7",                damage: s => Math.floor((s.atk + s.mag) * 0.7) },
      heal:        { name: "Curar",         desc: "MAG × 1.5 HP a un aliado",          heal:   s => Math.floor(s.mag * 1.5) },
      blessing:    { name: "Bendición",     desc: "+ATK MAG×0.3 a aliado por 3 turnos",effect: "blessing", value: s => Math.floor(s.mag * 0.3) },
    },
  },
};

// ── SISTEMA DE NIVELES ────────────────────────────────────────────────────────

const XP_PER_LEVEL = [0, 100, 300, 650, 1150, 1800];

const LEVEL_STAT_GAINS = {
  warrior: { hp: 10, atk: 2, def: 2, mag: 0, spd: 1, crit: 0 },
  mage:    { hp:  5, atk: 1, def: 1, mag: 3, spd: 0, crit: 1 },
  rogue:   { hp:  8, atk: 2, def: 1, mag: 0, spd: 2, crit: 2 },
  cleric:  { hp:  8, atk: 1, def: 2, mag: 2, spd: 1, crit: 0 },
};

const CLASS_LEVEL_SKILLS = {
  warrior: {
    2: { name: "Golpe Potente",    desc: "ATK × 1.5",                       damage: s => Math.floor(s.atk * 1.5) },
    3: { name: "Grito de Guerra",  desc: "+ATK×0.3 a todos los aliados 3t", effect: "battle_cry", value: s => Math.floor(s.atk * 0.3) },
    4: { name: "Torbellino",       desc: "ATK × 0.9 a TODOS los enemigos",  aoe: true, damage: s => Math.floor(s.atk * 0.9) },
    5: { name: "Golpe del Titán",  desc: "ATK × 2.5, ignora DEF",           damage: s => Math.floor(s.atk * 2.5), penetrate: true },
  },
  mage: {
    2: { name: "Nova de Hielo",    desc: "MAG × 1.0 a TODOS los enemigos",  aoe: true, damage: s => Math.floor(s.mag) },
    3: { name: "Escudo de Maná",   desc: "Absorbe daño con MAG 2 turnos",   effect: "mana_shield" },
    4: { name: "Tormenta Arcana",  desc: "MAG × 1.8 + stun",                damage: s => Math.floor(s.mag * 1.8), effect: "stun" },
    5: { name: "Meteoro",          desc: "MAG × 3.0",                       damage: s => Math.floor(s.mag * 3.0) },
  },
  rogue: {
    2: { name: "Golpe en la Sombra", desc: "ATK × 1.2, CRIT garantizado",   damage: s => Math.floor(s.atk * 1.2), forceCrit: true },
    3: { name: "Hemorragia",         desc: "ATK×0.5 + sangrado ATK×0.3 5t", damage: s => Math.floor(s.atk * 0.5), effect: "bleed", bleedValue: s => Math.floor(s.atk * 0.3) },
    4: { name: "Lluvia de Dagas",    desc: "ATK × 0.7 a TODOS los enemigos",aoe: true, damage: s => Math.floor(s.atk * 0.7) },
    5: { name: "Marca Mortal",       desc: "ATK × 3.0, ignora DEF, CRIT×2", damage: s => Math.floor(s.atk * 3.0), penetrate: true, forceCrit: true, critMult: 2.5 },
  },
  cleric: {
    2: { name: "Curación Masiva",  desc: "MAG × 0.8 a TODOS los aliados",   aoeHeal: true, heal: s => Math.floor(s.mag * 0.8) },
    3: { name: "Escudo Divino",    desc: "Aliado inmune al daño 1 turno",    effect: "divine_shield" },
    4: { name: "Juicio Divino",    desc: "(ATK+MAG) × 1.8",                  damage: s => Math.floor((s.atk + s.mag) * 1.8) },
    5: { name: "Resurrección",     desc: "Revive a un aliado al 50% HP",     effect: "revive" },
  },
};

// ── BASE DE DATOS DE ÍTEMS ────────────────────────────────────────────────────

const ITEM_DB = {
  iron_sword:      { name: "Espada de Hierro",      type: "weapon",    rarity: "common",    stats: { atk: 4 },                  scaling: { atk: 1.5 },          fits: ["warrior"] },
  steel_sword:     { name: "Espada de Acero",       type: "weapon",    rarity: "uncommon",  stats: { atk: 7, crit: 3 },         scaling: { atk: 2, crit: 1 },   fits: ["warrior"] },
  flame_blade:     { name: "Hoja de Llamas",        type: "weapon",    rarity: "rare",      stats: { atk: 10, mag: 5 },         scaling: { atk: 2.5, mag: 2 },  fits: ["warrior","cleric"] },
  titan_hammer:    { name: "Martillo del Titán",    type: "weapon",    rarity: "legendary", stats: { atk: 18, def: 4 },         scaling: { atk: 4, def: 1.5 },  fits: ["warrior"] },
  assassin_dagger: { name: "Daga del Asesino",      type: "weapon",    rarity: "uncommon",  stats: { atk: 6, spd: 3, crit: 5 },scaling: { atk: 1.5, crit: 1.5 },fits: ["rogue"] },
  shadow_blade:    { name: "Hoja de Sombra",        type: "weapon",    rarity: "rare",      stats: { atk: 9, spd: 5, crit: 8 },scaling: { atk: 2, spd: 1, crit: 2 }, fits: ["rogue"] },
  void_fang:       { name: "Colmillo del Vacío",    type: "weapon",    rarity: "legendary", stats: { atk: 14, spd: 8, crit:15 },scaling: { atk: 3, crit: 3 },   fits: ["rogue"] },
  arcane_staff:    { name: "Bastón Arcano",         type: "weapon",    rarity: "uncommon",  stats: { mag: 8 },                  scaling: { mag: 3 },            fits: ["mage"] },
  elder_staff:     { name: "Bastón Ancestral",      type: "weapon",    rarity: "rare",      stats: { mag: 14, spd: 2 },         scaling: { mag: 4, spd: 1 },    fits: ["mage"] },
  staff_of_doom:   { name: "Bastón de la Perdición",type: "weapon",    rarity: "legendary", stats: { mag: 22, crit: 10 },       scaling: { mag: 6, crit: 2 },   fits: ["mage"] },
  holy_mace:       { name: "Maza Sagrada",          type: "weapon",    rarity: "uncommon",  stats: { atk: 5, mag: 6 },          scaling: { atk: 1.5, mag: 2 },  fits: ["cleric"] },
  divine_scepter:  { name: "Cetro Divino",          type: "weapon",    rarity: "rare",      stats: { atk: 7, mag: 12 },         scaling: { atk: 2, mag: 3 },    fits: ["cleric"] },
  godsword:        { name: "Espada de los Dioses",  type: "weapon",    rarity: "legendary", stats: { atk: 12, mag: 18, def: 5 },scaling: { atk: 3, mag: 4 },    fits: ["cleric"] },
  leather_armor:   { name: "Armadura de Cuero",     type: "armor",     rarity: "common",    stats: { def: 4 },                  scaling: { def: 1.5 },          fits: null },
  chain_mail:      { name: "Cota de Malla",         type: "armor",     rarity: "uncommon",  stats: { def: 8, hp: 15 },          scaling: { def: 2, hp: 5 },     fits: ["warrior","cleric"] },
  dragon_scale:    { name: "Escama de Dragón",      type: "armor",     rarity: "rare",      stats: { def: 14, hp: 25 },         scaling: { def: 3, hp: 8 },     fits: ["warrior"] },
  mage_robe:       { name: "Túnica del Mago",       type: "armor",     rarity: "uncommon",  stats: { mag: 5, def: 4 },          scaling: { mag: 2, def: 1 },    fits: ["mage"] },
  arcane_vestment: { name: "Vestimenta Arcana",     type: "armor",     rarity: "rare",      stats: { mag: 10, def: 6, hp: 10 }, scaling: { mag: 3, def: 2 },    fits: ["mage"] },
  shadow_cloak:    { name: "Capa de Sombra",        type: "armor",     rarity: "uncommon",  stats: { spd: 4, def: 3, crit: 3 },scaling: { spd: 1.5, crit: 1 }, fits: ["rogue"] },
  phantom_veil:    { name: "Velo Fantasmal",        type: "armor",     rarity: "rare",      stats: { spd: 7, crit: 6, def: 5 },scaling: { spd: 2, crit: 1.5 }, fits: ["rogue"] },
  blessed_plate:   { name: "Placa Bendita",         type: "armor",     rarity: "uncommon",  stats: { def: 7, hp: 20 },          scaling: { def: 2, hp: 7 },     fits: ["cleric","warrior"] },
  vitality_ring:   { name: "Anillo de Vitalidad",   type: "accessory", rarity: "common",    stats: { hp: 20 },                  scaling: { hp: 8 },             fits: null },
  power_amulet:    { name: "Amuleto de Poder",      type: "accessory", rarity: "uncommon",  stats: { atk: 3, mag: 3 },          scaling: { atk: 1, mag: 1 },    fits: null },
  swift_boots:     { name: "Botas Veloces",         type: "accessory", rarity: "uncommon",  stats: { spd: 5 },                  scaling: { spd: 2 },            fits: null },
  crit_pendant:    { name: "Colgante de Precisión", type: "accessory", rarity: "uncommon",  stats: { crit: 6 },                 scaling: { crit: 2 },           fits: null },
  arcane_focus:    { name: "Foco Arcano",           type: "accessory", rarity: "rare",      stats: { mag: 8, crit: 5 },         scaling: { mag: 2.5, crit: 1.5 },fits: ["mage"] },
  ancient_talisman:{ name: "Talismán Ancestral",    type: "accessory", rarity: "legendary", stats: { atk: 5, def: 5, mag: 5, spd: 3, crit: 5, hp: 30 }, scaling: { atk: 1, def: 1, mag: 1, spd: 1, crit: 1, hp: 5 }, fits: null },
};

const RARITY_WEIGHTS = { common: 55, uncommon: 30, rare: 13, legendary: 2 };
const RARITY_MULT    = { common: 1.0, uncommon: 1.3, rare: 1.8, legendary: 2.8 };

// ── ESTADO DEL JUEGO ─────────────────────────────────────────────────────────

const game = {
  phase: "lobby",
  scenario: null,
  players: new Map(),  // ws → PlayerData
  enemies: [],
  turnOrder: [],
  turnIndex: 0,
  gm: null,
  lootQueue:  [],      // items waiting to be voted on
  activeVote: null,    // current LootVote object
  lootMode:   "need_greed", // default: "need_greed" | "council"
  duels: new Map(),    // duelId → DuelObject
  turnReminder: null,  // timeout for turn reminder
  turnLimit:    null,  // timeout for auto-defend at 2 min
  shop:         null,   // { name, items[] }
  dialog:       null,   // { npc, text, options[] }
  offlinePlayers: new Map(), // username → PlayerData (disconnected mid-adventure)
};

// ── SERVIDOR HTTP ─────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    const html = fs.readFileSync(path.join(__dirname, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  }
});

const wss = new WebSocketServer({ server });

// ── HELPERS ───────────────────────────────────────────────────────────────────

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}

function onlineUsers() {
  const users = [];
  for (const c of wss.clients) if (c.username) users.push(c.username);
  return users;
}

function sendInventory(ws, player) {
  send(ws, {
    type: "inventory_update",
    inventory: player.inventory,
    equipment: player.equipment,
  });
}

function playerSnapshot(p, offline = false) {
  return {
    username: p.username,
    classKey: p.classKey,
    className: p.className,
    emoji: p.emoji,
    hp: p.hp,
    maxHp: p.maxHp,
    stats: { ...p.stats },
    status: p.status.map(s => ({ type: s.type, turns: s.turns })),
    isDefending: p.isDefending,
    level: p.level,
    xp: p.xp,
    gold: p.gold || 0,
    xpToNext: XP_PER_LEVEL[Math.min(p.level, XP_PER_LEVEL.length - 1)] || 0,
    xpCurrent: XP_PER_LEVEL[p.level - 1] || 0,
    offline,
    prefix: p.prefix || null,
    suffix: p.suffix || null,
    equipment: {
      weapon:    p.equipment.weapon    ? { name: p.equipment.weapon.name,    rarity: p.equipment.weapon.rarity    } : null,
      armor:     p.equipment.armor     ? { name: p.equipment.armor.name,     rarity: p.equipment.armor.rarity     } : null,
      accessory: p.equipment.accessory ? { name: p.equipment.accessory.name, rarity: p.equipment.accessory.rarity } : null,
    },
  };
}

function broadcastState() {
  const players = [];
  for (const [, p] of game.players) players.push(playerSnapshot(p, false));
  for (const [, p] of game.offlinePlayers) players.push(playerSnapshot(p, true));
  broadcast({
    type: "game_state",
    phase: game.phase,
    scenario: game.scenario,
    players,
    enemies: game.enemies.map(e => ({
      name: e.name, hp: e.hp, maxHp: e.maxHp,
      atk: e.atk, def: e.def,
      tier: e.tier || "normal",
      icon: e.icon || null,
      color: e.color || null,
      status: (e.status || []).map(s => ({ type: s.type, turns: s.turns })),
    })),
    currentTurn: game.turnOrder[game.turnIndex] || null,
  });
}

function createPlayer(ws, className) {
  const cls = CLASSES[className];
  const baseStats = { ...cls.baseStats };
  const p = {
    ws,
    username: ws.username,
    classKey: className,
    className: cls.name,
    emoji: cls.emoji,
    hp: baseStats.hp,
    maxHp: baseStats.hp,
    baseStats,
    stats: { ...baseStats },
    status: [],
    isDefending: false,
    level: 1,
    xp: 0,
    equipment: { weapon: null, armor: null, accessory: null },
    inventory: [],
    learnedSkills: {},
    gold: 0,
    relations: {},  // { username: { affinity, history[] } }
    prefix: null,   // title before name
    suffix: null,   // title after name
  };
  game.players.set(ws, p);
  return p;
}

function updateRelation(player, targetUsername, affinityDelta, eventText) {
  if (!player || player.username === targetUsername) return;
  if (!player.relations[targetUsername])
    player.relations[targetUsername] = { affinity: 0, history: [] };
  const rel = player.relations[targetUsername];
  rel.affinity = Math.max(-10, Math.min(10, rel.affinity + affinityDelta));
  rel.history.unshift(eventText);
  if (rel.history.length > 4) rel.history.pop();
}

function findTarget(name) {
  for (const e of game.enemies) {
    if (e.name.toLowerCase() === name.toLowerCase() && e.hp > 0) return { type: "enemy", ref: e };
  }
  for (const [, p] of game.players) {
    if (p.username.toLowerCase() === name.toLowerCase() && p.hp > 0) return { type: "player", ref: p };
  }
  return null;
}

function getCurrentTurnPlayer() {
  const turn = game.turnOrder[game.turnIndex];
  if (!turn || turn.type !== "player") return null;
  for (const [, p] of game.players) if (p.username === turn.name) return p;
  return null;
}

function buildTurnOrder() {
  const order = [];
  for (const [, p] of game.players) order.push({ type: "player", name: p.username, spd: p.stats.spd });
  for (const e of game.enemies) {
    if (e.hp > 0) order.push({ type: "enemy", name: e.name, spd: e.spd || 5 });
  }
  order.sort((a, b) => b.spd - a.spd);
  return order;
}

function getPlayerAllSkills(player) {
  const base = CLASSES[player.classKey].skills;
  const result = { ...base };
  for (const [key, sk] of Object.entries(player.learnedSkills || {})) {
    result[key] = sk;
  }
  return result;
}

const TURN_REMINDER_MS = 25000; // remind after 25s of inactivity
const TURN_LIMIT_MS   = 120000; // auto-defend after 2 minutes

function clearTurnReminder() {
  if (game.turnReminder) { clearTimeout(game.turnReminder); game.turnReminder = null; }
  if (game.turnLimit)    { clearTimeout(game.turnLimit);    game.turnLimit    = null; }
}

function scheduleTurnReminder() {
  clearTurnReminder();
  game.turnReminder = setTimeout(() => {
    const turn = game.turnOrder[game.turnIndex];
    if (!turn) return;
    if (turn.type === "enemy") {
      broadcast({ type: "system", text: `⏰ ¡GM! Sigue esperando tu acción para ${turn.name}` });
      if (game.gm) send(game.gm, { type: "enemy_turn", enemy: turn.name, reminder: true });
    } else {
      broadcast({ type: "system", text: `⏰ ¡${turn.name}! Es tu turno, ¿qué haces?` });
      const player = getCurrentTurnPlayer();
      if (player) {
        const allSkills = getPlayerAllSkills(player);
        const skillList = Object.entries(allSkills).map(([k, s]) => ({
          key: k, name: s.name, desc: s.desc,
          available: s.condition ? s.condition(player) : true,
        }));
        send(player.ws, { type: "your_turn", skills: skillList, reminder: true });
      }
    }
    // keep reminding every TURN_REMINDER_MS
    scheduleTurnReminder();
  }, TURN_REMINDER_MS);
}

function notifyCurrentTurn() {
  const turn = game.turnOrder[game.turnIndex];
  if (!turn) return;
  if (turn.type === "enemy") {
    broadcast({ type: "system", text: `👹 Turno de ${turn.name} — el GM decide la acción` });
    send(game.gm, { type: "enemy_turn", enemy: turn.name });
    broadcast({ type: "turn_timer_stop" });
  } else {
    broadcast({ type: "system", text: `🎲 Turno de ${turn.name}` });
    const player = getCurrentTurnPlayer();
    if (player) {
      const allSkills = getPlayerAllSkills(player);
      const skillList = Object.entries(allSkills).map(([k, s]) => ({
        key: k, name: s.name, desc: s.desc,
        available: s.condition ? s.condition(player) : true,
      }));
      send(player.ws, { type: "your_turn", skills: skillList });
    }
    broadcast({ type: "turn_timer_start", player: turn.name, duration: TURN_LIMIT_MS });
    // Auto-defend when time expires
    game.turnLimit = setTimeout(() => {
      const current = getCurrentTurnPlayer();
      if (!current) return;
      broadcast({ type: "system", text: `⏱️ Tiempo agotado — ${current.username} defiende automáticamente` });
      current.isDefending = true;
      broadcastState();
      advanceTurn();
    }, TURN_LIMIT_MS);
  }
  broadcastState();
  scheduleTurnReminder();
}

function isEntryDead(entry) {
  if (entry.type === "enemy") {
    const e = game.enemies.find(e => e.name === entry.name);
    return !e || e.hp <= 0;
  }
  for (const [, p] of game.players) {
    if (p.username === entry.name) return p.hp <= 0;
  }
  return true;
}

function advanceTurn() {
  if (game.turnOrder.length === 0) return;
  clearTurnReminder();
  const prev = game.turnOrder[game.turnIndex];
  if (prev && prev.type === "player") {
    for (const [, p] of game.players) {
      if (p.username === prev.name) { p.isDefending = false; break; }
    }
  }
  // Advance and skip dead units
  const total = game.turnOrder.length;
  let checked = 0;
  do {
    game.turnIndex = (game.turnIndex + 1) % total;
    if (game.turnIndex === 0) applyDoTs();
    checked++;
  } while (checked < total && isEntryDead(game.turnOrder[game.turnIndex]));

  if (isEntryDead(game.turnOrder[game.turnIndex])) return; // everyone is dead
  notifyCurrentTurn();
}

function applyDoTs() {
  for (const [, p] of game.players) {
    p.status = p.status.filter(s => {
      if (s.type === "poison") {
        p.hp = Math.max(0, p.hp - s.value);
        broadcast({ type: "system", text: `☠️ ${p.username} sufre ${s.value} veneno (HP: ${p.hp}/${p.maxHp})` });
        s.turns--;
        return s.turns > 0;
      }
      if (s.type === "bleed") {
        p.hp = Math.max(0, p.hp - s.value);
        broadcast({ type: "system", text: `🩸 ${p.username} sufre ${s.value} sangrado (HP: ${p.hp}/${p.maxHp})` });
        s.turns--;
        return s.turns > 0;
      }
      if (s.type === "blessing") {
        s.turns--;
        if (s.turns <= 0) { p.stats.atk -= s.value; broadcast({ type: "system", text: `✨ Bendición de ${p.username} expiró` }); }
        return s.turns > 0;
      }
      if (s.type === "shield") {
        s.turns--;
        if (s.turns <= 0) { p.stats.def -= s.value; broadcast({ type: "system", text: `🧊 Escudo de hielo de ${p.username} se rompió` }); }
        return s.turns > 0;
      }
      if (s.type === "arcane_exhaust") {
        p.stats.mag += 10;
        broadcast({ type: "system", text: `🔮 ${p.username} recupera su poder arcano` });
        return false;
      }
      if (s.type === "battle_cry") {
        s.turns--;
        if (s.turns <= 0) { p.stats.atk -= s.value; broadcast({ type: "system", text: `⚔️ Grito de guerra de ${p.username} expiró` }); }
        return s.turns > 0;
      }
      if (s.type === "mana_shield") {
        s.turns--;
        return s.turns > 0;
      }
      if (s.type === "divine_shield") {
        s.turns--;
        return s.turns > 0;
      }
      s.turns--;
      return s.turns > 0;
    });
  }
  for (const e of game.enemies) {
    if (!e.status) continue;
    e.status = e.status.filter(s => {
      if (s.type === "poison") {
        e.hp = Math.max(0, e.hp - s.value);
        broadcast({ type: "system", text: `☠️ ${e.name} sufre ${s.value} veneno (HP: ${e.hp}/${e.maxHp})` });
        s.turns--;
        return s.turns > 0;
      }
      if (s.type === "bleed") {
        e.hp = Math.max(0, e.hp - s.value);
        broadcast({ type: "system", text: `🩸 ${e.name} sufre ${s.value} sangrado (HP: ${e.hp}/${e.maxHp})` });
        s.turns--;
        return s.turns > 0;
      }
      s.turns--;
      return s.turns > 0;
    });
  }
}

function removeDefeated(enemyName) {
  game.turnOrder = game.turnOrder.filter(t => !(t.type === "enemy" && t.name === enemyName));
  if (game.turnIndex >= game.turnOrder.length) game.turnIndex = 0;
}

// ── ITEMS / LOOT ──────────────────────────────────────────────────────────────

function calcItemStats(template, itemLevel, rarity) {
  const mult = RARITY_MULT[rarity];
  const stats = {};
  for (const [stat, base] of Object.entries(template.stats)) {
    const scale = (template.scaling[stat] || 0) * (itemLevel - 1);
    stats[stat] = Math.round((base + scale) * mult);
  }
  return stats;
}

function rollRarity(encounterLevel) {
  const w = { ...RARITY_WEIGHTS };
  if (encounterLevel >= 3) { w.rare += 5; w.common -= 5; }
  if (encounterLevel >= 5) { w.legendary += 3; w.rare += 5; w.uncommon -= 3; w.common -= 5; }
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const [r, weight] of Object.entries(w)) { roll -= weight; if (roll <= 0) return r; }
  return "common";
}

function generateLoot(encounterLevel, count = 1) {
  const items = [];
  const keys = Object.keys(ITEM_DB);
  for (let i = 0; i < count; i++) {
    const rarity = rollRarity(encounterLevel);
    const templateId = keys[Math.floor(Math.random() * keys.length)];
    const template = ITEM_DB[templateId];
    const itemLevel = Math.max(1, encounterLevel + (rarity === "rare" ? 1 : rarity === "legendary" ? 2 : 0));
    items.push({
      id: `${templateId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      templateId, name: template.name, type: template.type,
      rarity, level: itemLevel, stats: calcItemStats(template, itemLevel, rarity),
      fits: template.fits,
    });
  }
  return items;
}

// ── NIVEL / XP ────────────────────────────────────────────────────────────────

function recalcStats(player) {
  const oldHp = player.hp;
  player.stats = { ...player.baseStats };
  player.maxHp = player.baseStats.hp;
  for (const slot of ["weapon", "armor", "accessory"]) {
    const item = player.equipment[slot];
    if (!item) continue;
    for (const [stat, val] of Object.entries(item.stats)) {
      if (stat === "hp") player.maxHp += val;
      else player.stats[stat] = (player.stats[stat] || 0) + val;
    }
  }
  player.hp = Math.min(oldHp, player.maxHp);
}

function gainXP(player, amount) {
  if (player.level >= XP_PER_LEVEL.length - 1) return;
  player.xp += amount;
  while (player.level < XP_PER_LEVEL.length - 1 && player.xp >= XP_PER_LEVEL[player.level]) {
    levelUp(player);
  }
}

function levelUp(player) {
  player.level++;
  const gains = LEVEL_STAT_GAINS[player.classKey];
  for (const [stat, gain] of Object.entries(gains)) {
    player.baseStats[stat] = (player.baseStats[stat] || 0) + gain;
  }
  recalcStats(player);
  player.hp = player.maxHp; // full heal on level up
  const newSkill = CLASS_LEVEL_SKILLS[player.classKey]?.[player.level];
  if (newSkill) {
    player.learnedSkills[`lvlsk_${player.level}`] = newSkill;
  }
  broadcast({ type: "system", text: `🌟 ¡${player.username} subió al Nivel ${player.level}!${newSkill ? ` Nueva habilidad: ${newSkill.name}` : ""}` });
}

// ── HANDLERS ──────────────────────────────────────────────────────────────────

function handleJoin(ws, msg) {
  ws.username = msg.username;
  if (msg.role === "gm") {
    game.gm = ws;
    ws.isGM = true;
    broadcast({ type: "system", text: `👑 ${msg.username} es el Game Master` });
  } else {
    // Restore offline player if adventure is still active
    const offlinePlayer = game.offlinePlayers.get(msg.username);
    if (offlinePlayer && game.phase !== "lobby") {
      offlinePlayer.ws = ws;
      game.players.set(ws, offlinePlayer);
      game.offlinePlayers.delete(msg.username);
      broadcast({ type: "system", text: `${offlinePlayer.emoji} ${msg.username} volvió a la partida` });
      broadcast({ type: "users", users: onlineUsers() });
      send(ws, { type: "classes", classes: Object.entries(CLASSES).map(([k, c]) => ({
        key: k, name: c.name, emoji: c.emoji,
        stats: c.baseStats,
        skills: Object.entries(c.skills).map(([sk, s]) => ({ key: sk, name: s.name, desc: s.desc })),
      }))});
      send(ws, { type: "welcome", isGM: false, hasGM: game.gm !== null });
      sendInventory(ws, offlinePlayer);
      send(ws, { type: "gold_update", gold: offlinePlayer.gold || 0 });
      broadcastState();
      return;
    }
    broadcast({ type: "system", text: `${msg.username} se unió` });
  }
  broadcast({ type: "users", users: onlineUsers() });
  send(ws, { type: "classes", classes: Object.entries(CLASSES).map(([k, c]) => ({
    key: k, name: c.name, emoji: c.emoji,
    stats: c.baseStats,
    skills: Object.entries(c.skills).map(([sk, s]) => ({ key: sk, name: s.name, desc: s.desc })),
  }))});
  send(ws, { type: "welcome", isGM: ws.isGM, hasGM: game.gm !== null });
  broadcastState();
}

function handleChooseClass(ws, msg) {
  if (!CLASSES[msg.class]) return send(ws, { type: "error", text: "Clase inválida" });
  const p = createPlayer(ws, msg.class);
  broadcast({ type: "system", text: `${p.emoji} ${ws.username} eligió ${p.className}` });
  broadcastState();
}

function handleGM(ws, msg) {
  if (ws !== game.gm) return send(ws, { type: "error", text: "No eres el GM" });

  switch (msg.action) {
    case "scenario": {
      game.scenario = msg.text;
      game.phase = "adventure";
      broadcast({ type: "gm_scenario", text: msg.text });
      broadcastState();
      break;
    }
    case "event": {
      broadcast({ type: "gm_event", text: msg.text });
      break;
    }
    case "spawn_enemy": {
      // Purge dead enemies before spawning so stale entries don't accumulate
      game.enemies = game.enemies.filter(e => e.hp > 0);
      const tier = ["elite", "boss"].includes(msg.tier) ? msg.tier : "normal";
      const mult = tier === "boss"  ? { hp: 4,   atk: 2.2, def: 1.8, spd: 0.85 }
                 : tier === "elite" ? { hp: 1.8, atk: 1.4, def: 1.3, spd: 1.1  }
                 :                    { hp: 1,   atk: 1,   def: 1,   spd: 1    };
      const e = {
        name:  msg.name,
        hp:    Math.round((msg.hp  || 30) * mult.hp),
        maxHp: Math.round((msg.hp  || 30) * mult.hp),
        atk:   Math.round((msg.atk || 10) * mult.atk),
        def:   Math.round((msg.def ||  5) * mult.def),
        spd:   Math.round((msg.spd ||  5) * mult.spd),
        tier,
        icon:  msg.icon  || null,  // emoji or "ra-<icon>" class
        color: msg.color || null,  // CSS color for name text
        status: [],
      };
      game.enemies.push(e);
      const icon = tier === "boss"  ? "☠️  ¡¡JEFE!!"
                 : tier === "elite" ? "⚡ [ÉLITE]"
                 :                    "👹";
      broadcast({ type: "system", text: `${icon} Aparece ${e.name} (HP:${e.hp} ATK:${e.atk} DEF:${e.def} SPD:${e.spd})` });
      broadcastState();
      break;
    }
    case "combat_start": {
      game.phase = "combat";
      game.turnOrder = buildTurnOrder();
      game.turnIndex = 0;
      broadcast({ type: "system", text: `⚔️ ¡COMBATE! Orden: ${game.turnOrder.map(t => t.name).join(" → ")}` });
      notifyCurrentTurn();
      break;
    }
    case "combat_end": {
      clearTurnReminder();
      broadcast({ type: "turn_timer_stop" });
      game.phase = "adventure";
      game.enemies = game.enemies.filter(e => e.hp > 0);
      game.turnOrder = [];
      game.turnIndex = 0;
      broadcast({ type: "system", text: `🏆 Combate finalizado` });
      broadcastState();
      break;
    }
    case "enemy_attack": {
      const enemy = game.enemies.find(e => e.name === msg.enemy && e.hp > 0);
      if (!enemy) return send(ws, { type: "error", text: "Enemigo no encontrado" });
      const target = findTarget(msg.target);
      if (!target || target.type !== "player") return send(ws, { type: "error", text: "Jugador no encontrado" });
      const player = target.ref;

      // divine_shield check
      const divineIdx = player.status.findIndex(s => s.type === "divine_shield");
      if (divineIdx >= 0) {
        player.status.splice(divineIdx, 1);
        broadcast({ type: "system", text: `✝️ ${player.username} está protegido por Escudo Divino — daño negado` });
        broadcastState();
        advanceTurn();
        break;
      }

      // dodge check
      const dodgeIdx = player.status.findIndex(s => s.type === "dodge");
      if (dodgeIdx >= 0) {
        player.status.splice(dodgeIdx, 1);
        broadcast({ type: "system", text: `🌫️ ${player.username} esquiva el ataque de ${enemy.name}` });
      } else {
        const def = player.isDefending ? player.stats.def * 1.5 : player.stats.def;
        let dmg = Math.max(1, enemy.atk - Math.floor(def * 0.5));

        // mana_shield check
        const manaShieldIdx = player.status.findIndex(s => s.type === "mana_shield");
        if (manaShieldIdx >= 0) {
          const mag = player.stats.mag || 0;
          if (mag >= dmg) {
            player.stats.mag = Math.max(0, player.stats.mag - dmg);
            broadcast({ type: "system", text: `🔮 Escudo de Maná de ${player.username} absorbió ${dmg} de daño` });
            dmg = 0;
          } else {
            dmg -= mag;
            broadcast({ type: "system", text: `🔮 Escudo de Maná de ${player.username} absorbió ${mag}, resta ${dmg}` });
            player.stats.mag = 0;
            player.status.splice(manaShieldIdx, 1);
          }
        }

        if (dmg > 0) {
          player.hp = Math.max(0, player.hp - dmg);
          broadcast({ type: "combat_hit", attacker: enemy.name, atkIsEnemy: true, target: player.username, tgtIsEnemy: false });
          broadcast({ type: "system", text: `👹 ${enemy.name} ataca a ${player.username} por ${dmg} (HP: ${player.hp}/${player.maxHp})` });
          if (player.hp === 0) broadcast({ type: "system", text: `💀 ${player.username} fue derrotado` });
        }
      }
      player.isDefending = false;
      broadcastState();
      advanceTurn();
      break;
    }
    case "reward": {
      broadcast({ type: "gm_event", text: `🎁 ${msg.text}` });
      break;
    }
    case "loot": {
      const lvl  = Math.max(1, Math.min(5, msg.level || 1));
      const cnt  = Math.min(5, msg.count || 1);
      const mode = ["need_greed","council"].includes(msg.mode) ? msg.mode : game.lootMode;
      const items = generateLoot(lvl, cnt);
      for (const item of items) queueLoot(item, mode);
      break;
    }
    case "lootmode": {
      if (!["need_greed","council"].includes(msg.mode)) return send(ws, { type: "error", text: "Modo inválido: need_greed | council" });
      game.lootMode = msg.mode;
      broadcast({ type: "system", text: `⚙️  Sistema de loot: ${msg.mode === "council" ? "Consejo" : "Need/Greed/Pass"}` });
      break;
    }
    case "open_shop": {
      const lvl   = Math.max(1, Math.min(5, msg.level || 1));
      const count = Math.min(10, msg.count || 5);
      const items = msg.items ? msg.items : generateShopInventory(lvl, count);
      game.shop = { name: msg.name || "Tienda", items };
      broadcast({ type: "shop_open", name: game.shop.name, items: game.shop.items });
      broadcast({ type: "system", text: `🛒 ${game.shop.name} abrió sus puertas` });
      break;
    }
    case "close_shop": {
      if (!game.shop) break;
      broadcast({ type: "system", text: `🛒 ${game.shop.name} cerró sus puertas` });
      game.shop = null;
      broadcast({ type: "shop_closed" });
      break;
    }
    case "dialog": {
      const dlg = { npc: msg.npc || "NPC", text: msg.text || "", options: Array.isArray(msg.options) ? msg.options : [], votes: {} };
      game.dialog = dlg;
      broadcast({ type: "dialog", npc: dlg.npc, text: dlg.text, options: dlg.options });
      break;
    }
    case "dialog_close": {
      game.dialog = null;
      broadcast({ type: "dialog_close" });
      break;
    }
    case "reset_adventure": {
      clearTurnReminder();
      broadcast({ type: "turn_timer_stop" });
      if (game.activeVote) { clearTimeout(game.activeVote.timeout); }
      for (const [, d] of game.duels) { clearTimeout(d.timeout); clearDuelReminder(d); }
      game.phase      = "lobby";
      game.scenario   = null;
      game.enemies    = [];
      game.turnOrder  = [];
      game.turnIndex  = 0;
      game.lootQueue  = [];
      game.activeVote = null;
      game.lootMode   = "need_greed";
      game.duels      = new Map();
      game.shop       = null;
      game.dialog     = null;
      game.players    = new Map();
      broadcast({ type: "system", text: `🔄 ${ws.username} reinició la aventura — ¡elijan sus clases!` });
      broadcast({
        type: "adventure_reset",
        classes: Object.entries(CLASSES).map(([k, c]) => ({
          key: k, name: c.name, emoji: c.emoji,
          stats: c.baseStats,
          skills: Object.entries(c.skills).map(([sk, s]) => ({ key: sk, name: s.name, desc: s.desc })),
        })),
      });
      broadcastState();
      break;
    }
    case "give_gold": {
      const amount = Math.max(0, Math.floor(msg.amount || 0));
      if (msg.target) {
        const p = findPlayerByName(msg.target);
        if (!p) return send(ws, { type: "error", text: `Jugador "${msg.target}" no encontrado` });
        p.gold = (p.gold || 0) + amount;
        send(p.ws, { type: "gold_update", gold: p.gold });
        broadcast({ type: "system", text: `💰 ${p.username} recibe ${amount} monedas` });
      } else {
        for (const [, p] of game.players) {
          p.gold = (p.gold || 0) + amount;
          send(p.ws, { type: "gold_update", gold: p.gold });
        }
        broadcast({ type: "system", text: `💰 Todos reciben ${amount} monedas de oro` });
      }
      broadcastState();
      break;
    }
    case "set_title": {
      const target = msg.target ? findPlayerByName(msg.target) : null;
      const targets = target ? [target] : [...game.players.values()];
      for (const p of targets) {
        if (msg.prefix !== undefined) p.prefix = (msg.prefix || "").slice(0, 30) || null;
        if (msg.suffix !== undefined) p.suffix = (msg.suffix || "").slice(0, 30) || null;
      }
      broadcastState();
      break;
    }
  }
}

const TIER_REWARDS = {
  normal: { xpMult: 1,   goldMult: 1,   lootChance: 0.40, lootCount: 1, lootLvlBonus: 0 },
  elite:  { xpMult: 2.5, goldMult: 2.5, lootChance: 0.85, lootCount: 2, lootLvlBonus: 1 },
  boss:   { xpMult: 6,   goldMult: 5,   lootChance: 1.0,  lootCount: 3, lootLvlBonus: 2 },
};

function handleEnemyDeath(enemy) {
  const tr = TIER_REWARDS[enemy.tier || "normal"];
  const tierLabel = enemy.tier === "boss"  ? "☠️ ¡JEFE DERROTADO!"
                  : enemy.tier === "elite" ? "⚡ Élite derrotado"
                  :                         "💀";
  broadcast({ type: "unit_died", name: enemy.name });
  broadcast({ type: "system", text: `${tierLabel} ${enemy.name} derrotado` });
  removeDefeated(enemy.name);

  const xp = Math.floor((enemy.maxHp + enemy.atk * 3 + enemy.def * 2) / 5 * tr.xpMult);
  for (const [, p] of game.players) if (p.hp > 0) gainXP(p, xp);
  broadcast({ type: "system", text: `⭐ +${xp} XP` });

  const gold = Math.floor((enemy.maxHp + enemy.atk * 2 + enemy.def) / 6 * tr.goldMult);
  for (const [, p] of game.players) if (p.hp > 0) { p.gold = (p.gold || 0) + gold; send(p.ws, { type: "gold_update", gold: p.gold }); }
  broadcast({ type: "system", text: `💰 +${gold} monedas de oro` });

  if (Math.random() < tr.lootChance) {
    const baseLvl = Math.max(1, Math.min(5, Math.ceil((enemy.atk + enemy.def) / 8)));
    const lootLvl = Math.min(5, baseLvl + tr.lootLvlBonus);
    const items = generateLoot(lootLvl, tr.lootCount);
    for (const item of items) queueLoot(item, game.lootMode);
  }
}

function handleAction(ws, msg) {
  if (game.phase !== "combat") return send(ws, { type: "error", text: "No estás en combate" });
  const player = game.players.get(ws);
  if (!player) return send(ws, { type: "error", text: "Primero elige una clase" });
  const current = getCurrentTurnPlayer();
  if (!current || current.ws !== ws) return send(ws, { type: "error", text: "No es tu turno" });

  if (msg.action === "skip") {
    broadcast({ type: "system", text: `⏭️ ${player.username} pasó su turno` });
    broadcastState();
    advanceTurn();
    return;
  }

  if (msg.action === "defend") {
    player.isDefending = true;
    broadcast({ type: "system", text: `🛡️ ${player.username} se defiende (DEF×1.5 hasta el próximo turno)` });
    broadcastState();
    advanceTurn();
    return;
  }

  if (msg.action === "attack") {
    const target = findTarget(msg.target);
    if (!target || target.type !== "enemy") return send(ws, { type: "error", text: "Objetivo inválido" });
    const enemy = target.ref;
    let dmg = Math.max(1, player.stats.atk - Math.floor(enemy.def * 0.5));
    const isCrit = Math.random() * 100 < player.stats.crit;
    if (isCrit) dmg = Math.floor(dmg * 1.5);
    enemy.hp = Math.max(0, enemy.hp - dmg);
    broadcast({ type: "combat_hit", attacker: player.username, atkIsEnemy: false, target: enemy.name, tgtIsEnemy: true, crit: isCrit });
    broadcast({ type: "system", text: `${player.emoji} ${player.username} ataca a ${enemy.name} por ${dmg}${isCrit ? " 💥CRÍTICO!" : ""} (HP: ${enemy.hp}/${enemy.maxHp})` });
    if (enemy.hp === 0) { handleEnemyDeath(enemy); broadcastState(); if (!allEnemiesDead() && game.turnOrder.length > 0) advanceTurn(); else finalizeCombat(); return; }
    broadcastState();
    if (game.turnOrder.length > 0) advanceTurn();
    return;
  }

  if (msg.action === "skill") {
    const allSkills = getPlayerAllSkills(player);
    const skillDef = allSkills[msg.skill];
    if (!skillDef) return send(ws, { type: "error", text: "Habilidad inválida" });
    if (skillDef.condition && !skillDef.condition(player)) return send(ws, { type: "error", text: `No puedes usar ${skillDef.name} ahora` });

    // AOE Heal
    if (skillDef.aoeHeal) {
      const amt = skillDef.heal(player.stats);
      for (const [, p] of game.players) {
        p.hp = Math.min(p.maxHp, p.hp + amt);
      }
      broadcast({ type: "system", text: `✨ ${player.username} usa ${skillDef.name} → +${amt} HP a todos los aliados` });
      broadcastState();
      advanceTurn();
      return;
    }

    // Single Heal
    if (skillDef.heal && !skillDef.aoeHeal) {
      const targetRef = msg.target ? findTarget(msg.target) : { type: "player", ref: player };
      if (!targetRef || targetRef.type !== "player") return send(ws, { type: "error", text: "Objetivo inválido para curar" });
      const tgt = targetRef.ref;
      const amt = skillDef.heal(player.stats);
      tgt.hp = Math.min(tgt.maxHp, tgt.hp + amt);
      broadcast({ type: "system", text: `✨ ${player.username} usa ${skillDef.name} → +${amt} HP a ${tgt.username} (HP: ${tgt.hp}/${tgt.maxHp})` });
      if (tgt.username !== player.username) {
        updateRelation(player, tgt.username, +2, `Curó a ${tgt.username}`);
        updateRelation(tgt, player.username, +2, `Curado por ${player.username}`);
      }
      broadcastState();
      advanceTurn();
      return;
    }

    // Special effect: revive
    if (skillDef.effect === "revive") {
      let revived = null;
      for (const [, p] of game.players) {
        if (p.hp === 0) { revived = p; break; }
      }
      if (!revived) {
        broadcast({ type: "system", text: `✨ ${player.username} usa ${skillDef.name} — no hay aliados derrotados` });
      } else {
        revived.hp = Math.floor(revived.maxHp * 0.5);
        broadcast({ type: "system", text: `✨ ${player.username} usa ${skillDef.name} → revive a ${revived.username} al 50% HP` });
        updateRelation(player, revived.username, +4, `Revivió a ${revived.username}`);
        updateRelation(revived, player.username, +4, `Revivido por ${player.username}`);
      }
      broadcastState();
      advanceTurn();
      return;
    }

    // Only-effect skills (no damage)
    if (!skillDef.damage && !skillDef.aoe) {
      if (skillDef.effect === "dodge") {
        player.status.push({ type: "dodge", turns: 1 });
        broadcast({ type: "system", text: `🌫️ ${player.username} usa ${skillDef.name}` });
      } else if (skillDef.effect === "shield") {
        const val = skillDef.value(player.stats);
        player.stats.def += val;
        player.status.push({ type: "shield", value: val, turns: 2 });
        broadcast({ type: "system", text: `🧊 ${player.username} usa ${skillDef.name} (+${val} DEF por 2 turnos)` });
      } else if (skillDef.effect === "mana_shield") {
        player.status.push({ type: "mana_shield", turns: 2 });
        broadcast({ type: "system", text: `🔮 ${player.username} usa ${skillDef.name} (Escudo de Maná 2 turnos)` });
      } else if (skillDef.effect === "divine_shield") {
        const targetRef = msg.target ? findTarget(msg.target) : { type: "player", ref: player };
        if (!targetRef || targetRef.type !== "player") return send(ws, { type: "error", text: "Objetivo inválido" });
        const tgt = targetRef.ref;
        tgt.status.push({ type: "divine_shield", turns: 1 });
        broadcast({ type: "system", text: `✝️ ${player.username} usa ${skillDef.name} → ${tgt.username} es inmune 1 turno` });
      } else if (skillDef.effect === "blessing") {
        const targetRef = msg.target ? findTarget(msg.target) : { type: "player", ref: player };
        if (!targetRef || targetRef.type !== "player") return send(ws, { type: "error", text: "Objetivo inválido" });
        const tgt = targetRef.ref;
        const val = skillDef.value(player.stats);
        tgt.stats.atk += val;
        tgt.status.push({ type: "blessing", value: val, turns: 3 });
        broadcast({ type: "system", text: `✨ ${player.username} usa ${skillDef.name} → +${val} ATK a ${tgt.username} por 3 turnos` });
      } else if (skillDef.effect === "battle_cry") {
        const val = skillDef.value(player.stats);
        for (const [, p] of game.players) {
          p.stats.atk += val;
          p.status.push({ type: "battle_cry", value: val, turns: 3 });
          if (p.username !== player.username) updateRelation(player, p.username, +1, `Fortaleció con grito de guerra`);
        }
        broadcast({ type: "system", text: `⚔️ ${player.username} usa ${skillDef.name} → +${val} ATK a todos los aliados por 3 turnos` });
      }
      broadcastState();
      advanceTurn();
      return;
    }

    // AOE damage skill
    if (skillDef.aoe) {
      const liveEnemies = game.enemies.filter(e => e.hp > 0);
      if (liveEnemies.length === 0) return send(ws, { type: "error", text: "No hay enemigos" });
      let hits = [];
      let anyDied = false;
      for (const enemy of liveEnemies) {
        let dmg = skillDef.damage(player.stats);
        let isCrit = skillDef.forceCrit || Math.random() * 100 < player.stats.crit;
        const critMult = skillDef.critMult || 1.5;
        if (isCrit) dmg = Math.floor(dmg * critMult);
        if (!skillDef.penetrate) dmg = Math.max(1, dmg - Math.floor(enemy.def * 0.5));
        enemy.hp = Math.max(0, enemy.hp - dmg);
        hits.push(`${enemy.name}: ${dmg}${isCrit ? "💥" : ""} (HP:${enemy.hp})`);
        if (enemy.hp === 0) anyDied = true;
      }
      broadcast({ type: "combat_hit", attacker: player.username, atkIsEnemy: false, targets: liveEnemies.map(e => e.name), tgtIsEnemy: true, aoe: true });
      broadcast({ type: "system", text: `${player.emoji} ${player.username} usa ${skillDef.name} → ${hits.join(", ")}` });
      for (const enemy of liveEnemies) {
        if (enemy.hp === 0) handleEnemyDeath(enemy);
      }
      broadcastState();
      if (!allEnemiesDead() && game.turnOrder.length > 0) advanceTurn(); else finalizeCombat();
      return;
    }

    // Single-target damage skill
    const target = findTarget(msg.target);
    if (!target || target.type !== "enemy") return send(ws, { type: "error", text: "Objetivo inválido" });
    const enemy = target.ref;
    let dmg = skillDef.damage(player.stats);
    let isCrit = skillDef.forceCrit || Math.random() * 100 < player.stats.crit;
    const critMult = skillDef.critMult || 1.5;
    if (isCrit) dmg = Math.floor(dmg * critMult);
    if (!skillDef.penetrate) dmg = Math.max(1, dmg - Math.floor(enemy.def * 0.5));
    enemy.hp = Math.max(0, enemy.hp - dmg);

    let fx = "";
    if (skillDef.effect === "stun") {
      enemy.status = enemy.status || [];
      enemy.status.push({ type: "stun", turns: 1 });
      game.turnOrder = game.turnOrder.filter(t => !(t.type === "enemy" && t.name === enemy.name));
      if (enemy.hp > 0) game.turnOrder.push({ type: "enemy", name: enemy.name, spd: enemy.spd || 5 });
      if (game.turnIndex >= game.turnOrder.length) game.turnIndex = 0;
      fx = " + aturde";
    } else if (skillDef.effect === "poison") {
      const pdmg = Math.floor(player.stats.atk * 0.2);
      enemy.status = enemy.status || [];
      enemy.status.push({ type: "poison", value: pdmg, turns: 3 });
      fx = ` + veneno(${pdmg}/turno)`;
    } else if (skillDef.effect === "bleed") {
      const bdmg = skillDef.bleedValue ? skillDef.bleedValue(player.stats) : Math.floor(player.stats.atk * 0.3);
      enemy.status = enemy.status || [];
      enemy.status.push({ type: "bleed", value: bdmg, turns: 5 });
      fx = ` + sangrado(${bdmg}/turno)`;
    } else if (skillDef.effect === "arcane_exhaust") {
      player.stats.mag -= 10;
      player.status.push({ type: "arcane_exhaust", turns: 1 });
      fx = " (−10 MAG 1 turno)";
    }

    broadcast({ type: "combat_hit", attacker: player.username, atkIsEnemy: false, target: enemy.name, tgtIsEnemy: true, crit: isCrit });
    broadcast({ type: "system", text: `${player.emoji} ${player.username} usa ${skillDef.name} → ${dmg}${isCrit ? " 💥CRÍTICO!" : ""} a ${enemy.name}${fx} (HP: ${enemy.hp}/${enemy.maxHp})` });
    if (enemy.hp === 0) { handleEnemyDeath(enemy); broadcastState(); if (!allEnemiesDead() && game.turnOrder.length > 0) advanceTurn(); else finalizeCombat(); return; }
    broadcastState();
    if (game.turnOrder.length > 0) advanceTurn();
  }
}

// ── RESET DE MESA ────────────────────────────────────────────────────────────

function resetGameTable() {
  clearTurnReminder();
  broadcast({ type: "turn_timer_stop" });
  broadcast({ type: "loot_timer_stop" });
  if (game.activeVote) { clearTimeout(game.activeVote.timeout); }
  for (const [, d] of game.duels) { clearTimeout(d.timeout); clearDuelReminder(d); }
  game.phase      = "lobby";
  game.scenario   = null;
  game.enemies    = [];
  game.turnOrder  = [];
  game.turnIndex  = 0;
  game.lootQueue  = [];
  game.activeVote = null;
  game.lootMode   = "need_greed";
  game.duels         = new Map();
  game.shop          = null;
  game.dialog        = null;
  game.offlinePlayers = new Map();
  // Remove stale player entries (keep connected players who will re-register)
  const connectedWs = new Set(wss.clients);
  for (const [ws] of game.players) {
    if (!connectedWs.has(ws) || ws.readyState !== 1) game.players.delete(ws);
  }
}

// ── FIN DE ENCUENTRO ─────────────────────────────────────────────────────────

function allEnemiesDead() {
  return game.enemies.length === 0 || game.enemies.every(e => e.hp <= 0);
}

function finalizeCombat() {
  if (game.phase !== "combat") return;
  // still waiting on loot votes → awardItem will call us again
  if (game.activeVote || game.lootQueue.length > 0) return;
  clearTurnReminder();
  broadcast({ type: "turn_timer_stop" });
  game.phase     = "adventure";
  game.enemies   = [];
  game.turnOrder = [];
  game.turnIndex = 0;
  broadcast({ type: "system", text: `🏆 ¡Todos los enemigos derrotados! El GM retoma el control` });
  broadcastState();
  if (game.gm) send(game.gm, { type: "encounter_complete" });
}

// ── TIENDA ───────────────────────────────────────────────────────────────────

function shopPrice(item) {
  const base = { common: 40, uncommon: 90, rare: 200, legendary: 450 };
  const perLevel = { common: 15, uncommon: 30, rare: 60, legendary: 120 };
  return (base[item.rarity] || 40) + (item.level || 1) * (perLevel[item.rarity] || 15);
}

function generateShopInventory(level, count = 5) {
  const items = generateLoot(level, count);
  return items.map(i => ({ ...i, price: shopPrice(i) }));
}

// ── SISTEMA DE VOTACIÓN DE LOOT ───────────────────────────────────────────────

function activePlayers() {
  return [...game.players.values()];
}

function queueLoot(item, mode) {
  broadcast({ type: "system", text: `💎 Cayó: ${item.name} [${item.rarity} nv.${item.level}]` });
  if (game.activeVote) {
    game.lootQueue.push({ item, mode });
    broadcast({ type: "system", text: `📋  En cola: ${item.name} (${game.lootQueue.length} pendientes)` });
  } else {
    startVote(item, mode);
  }
}

function startVote(item, mode, phase = mode, eligible = null) {
  const players = activePlayers();
  const vote = {
    item, mode, phase,
    votes: new Map(),
    eligible: eligible || players.map(p => p.username),
    resolved: false,
    timeout: setTimeout(() => resolveVote(), 60000),
  };
  game.activeVote = vote;
  const modeLabel = phase === "council"
    ? `📊  Consejo — usa /voteitem <jugador>`
    : `🎲  Need/Greed/Pass — usa /vote need | greed | pass`;
  broadcast({ type: "loot_vote", item: publicItem(item), mode: phase, eligible: vote.eligible });
  broadcast({ type: "loot_timer_start", duration: 60000 });
  broadcast({ type: "system", text: `${modeLabel} (60s — ${players.length} jugador${players.length !== 1 ? "es" : ""})` });
}

function publicItem(item) {
  return { id: item.id, name: item.name, type: item.type, rarity: item.rarity, level: item.level, stats: item.stats };
}

function checkAutoResolve() {
  if (!game.activeVote) return;
  const total = activePlayers().length;
  if (game.activeVote.votes.size >= total) setTimeout(resolveVote, 400);
}

function resolveVote() {
  const vote = game.activeVote;
  if (!vote || vote.resolved) return;
  vote.resolved = true;
  clearTimeout(vote.timeout);
  broadcast({ type: "loot_timer_stop" });

  if (vote.phase === "council") {
    resolveCouncil(vote);
  } else {
    resolveNeedGreed(vote);
  }
}

function resolveCouncil(vote) {
  // count votes
  const counts = {};
  for (const target of vote.votes.values()) counts[target] = (counts[target] || 0) + 1;
  const log = Object.entries(counts).map(([u, v]) => `${u}: ${v}`).join(" | ") || "sin votos";
  broadcast({ type: "system", text: `📊  Votos del Consejo: ${log}` });
  if (Object.keys(counts).length === 0) { awardItem(vote.item, null); return; }
  const maxVotes = Math.max(...Object.values(counts));
  const leaders = Object.keys(counts).filter(u => counts[u] === maxVotes);
  if (leaders.length === 1) {
    awardItem(vote.item, leaders[0]);
  } else {
    broadcast({ type: "system", text: `⚖️  Empate entre: ${leaders.join(", ")} — pasando a Need/Greed/Pass` });
    startVote(vote.item, vote.mode, "need_greed", leaders);
  }
}

function resolveNeedGreed(vote) {
  const needs = [], greeds = [];
  for (const username of (vote.eligible || activePlayers().map(p => p.username))) {
    const v = vote.votes.get(username) || "pass";
    if (v === "need")  needs.push(username);
    if (v === "greed") greeds.push(username);
  }
  const passers = (vote.eligible || activePlayers().map(p => p.username))
    .filter(u => !needs.includes(u) && !greeds.includes(u));
  broadcast({ type: "system", text: `🗳️  Need: [${needs.join(",")||"—"}]  Greed: [${greeds.join(",")||"—"}]  Pass: [${passers.join(",")||"—"}]` });
  const pool = needs.length > 0 ? needs : greeds;
  if (pool.length === 0) { awardItem(vote.item, null); return; }
  rollForWinner(pool, vote.item);
}

function rollForWinner(pool, item) {
  const rolls = {};
  for (const u of pool) rolls[u] = Math.floor(Math.random() * 100) + 1;
  const maxRoll = Math.max(...Object.values(rolls));
  const tied = Object.keys(rolls).filter(u => rolls[u] === maxRoll);
  broadcast({ type: "system", text: `🎲  Tiradas: ${Object.entries(rolls).map(([u,r]) => `${u}: ${r}`).join(" | ")}` });
  if (tied.length === 1) {
    awardItem(item, tied[0]);
  } else {
    broadcast({ type: "system", text: `🎲  Empate (${maxRoll}) — repitiendo entre: ${tied.join(", ")}` });
    rollForWinner(tied, item);
  }
}

function awardItem(item, username) {
  if (username) {
    const player = findPlayerByName(username);
    if (player) {
      player.inventory.push(item);
      sendInventory(player.ws, player);
    }
    broadcast({ type: "system", text: `🎉  ${item.name} fue a ${username}!` });
    broadcast({ type: "loot_awarded", itemId: item.id, winner: username });
  } else {
    broadcast({ type: "system", text: `🗑️  ${item.name} no fue reclamado` });
    broadcast({ type: "loot_awarded", itemId: item.id, winner: null });
  }
  game.activeVote = null;
  if (game.lootQueue.length > 0) {
    const next = game.lootQueue.shift();
    setTimeout(() => startVote(next.item, next.mode), 1000);
  } else {
    // All loot distributed — end combat if all enemies are dead
    if (allEnemiesDead()) setTimeout(finalizeCombat, 600);
  }
}

// ── DUELOS ────────────────────────────────────────────────────────────────────

function findPlayerByName(name) {
  for (const [, p] of game.players)
    if (p.username.toLowerCase() === name.toLowerCase()) return p;
  return null;
}

function getDuelForPlayer(player) {
  for (const [, d] of game.duels)
    if ((d.challenger === player || d.challenged === player) && d.status !== "finished") return d;
  return null;
}

function broadcastDuelState(duel) {
  broadcast({
    type: "duel_state",
    duelId: duel.id,
    status: duel.status,
    currentTurn: duel.status === "active" ? duel.turnOrder[duel.turnIndex]?.username : null,
    players: [duel.challenger, duel.challenged].map(p => ({
      username: p.username, classKey: p.classKey, hp: p.hp, maxHp: p.maxHp,
    })),
  });
}

function clearDuelReminder(duel) {
  if (duel.reminder) { clearTimeout(duel.reminder); duel.reminder = null; }
}

function scheduleDuelReminder(duel) {
  clearDuelReminder(duel);
  duel.reminder = setTimeout(() => {
    if (duel.status !== "active") return;
    const current = duel.turnOrder[duel.turnIndex];
    const opponent = current === duel.challenger ? duel.challenged : duel.challenger;
    broadcast({ type: "system", text: `⏰ ¡${current.username}! Es tu turno en el duelo, ¿atacas o te defiendes?` });
    const skills = Object.entries(getPlayerAllSkills(current)).map(([k, s]) => ({
      key: k, name: s.name, desc: s.desc, available: s.condition ? s.condition(current) : true,
    }));
    send(current.ws, { type: "duel_your_turn", duelId: duel.id, skills, opponentName: opponent.username, reminder: true });
    scheduleDuelReminder(duel);
  }, TURN_REMINDER_MS);
}

function notifyDuelTurn(duel) {
  const current = duel.turnOrder[duel.turnIndex];
  const opponent = current === duel.challenger ? duel.challenged : duel.challenger;
  broadcast({ type: "system", text: `⚔️  [Duelo] Turno de ${current.username}` });
  const skills = Object.entries(getPlayerAllSkills(current)).map(([k, s]) => ({
    key: k, name: s.name, desc: s.desc, available: s.condition ? s.condition(current) : true,
  }));
  send(current.ws, { type: "duel_your_turn", duelId: duel.id, skills, opponentName: opponent.username });
  send(opponent.ws, { type: "duel_wait", duelId: duel.id, currentTurn: current.username });
  broadcastDuelState(duel);
  scheduleDuelReminder(duel);
}

function applyDuelDoTs(duel) {
  for (const p of [duel.challenger, duel.challenged]) {
    p.status = p.status.filter(s => {
      if (s.type === "poison" || s.type === "bleed") {
        p.hp = Math.max(0, p.hp - s.value);
        broadcast({ type: "system", text: `☠️  [Duelo] ${p.username} sufre ${s.value} por ${s.type} (HP: ${p.hp}/${p.maxHp})` });
        if (p.hp <= 0) {
          const winner = p === duel.challenger ? duel.challenged : duel.challenger;
          endDuel(duel, winner, s.type);
        }
        return --s.turns > 0;
      }
      if (s.type === "shield")        { s.turns--; if (s.turns <= 0) p.stats.def -= s.value; return s.turns > 0; }
      if (s.type === "arcane_exhaust"){ p.stats.mag += 10; return false; }
      return --s.turns > 0;
    });
  }
}

function advanceDuelTurn(duel) {
  if (duel.status !== "active") return;
  clearDuelReminder(duel);
  duel.turnIndex = (duel.turnIndex + 1) % 2;
  if (duel.turnIndex === 0) applyDuelDoTs(duel);
  if (duel.status !== "active") return;
  // skip stunned player
  const current = duel.turnOrder[duel.turnIndex];
  const stunIdx = current.status.findIndex(s => s.type === "stun");
  if (stunIdx >= 0) {
    current.status.splice(stunIdx, 1);
    broadcast({ type: "system", text: `💫  [Duelo] ${current.username} está aturdido — pierde su turno` });
    duel.turnIndex = (duel.turnIndex + 1) % 2;
    if (duel.turnIndex === 0) applyDuelDoTs(duel);
    if (duel.status !== "active") return;
  }
  notifyDuelTurn(duel);
}

function endDuel(duel, winner, reason) {
  if (duel.status === "finished") return;
  duel.status = "finished";
  clearTimeout(duel.timeout);
  clearDuelReminder(duel);
  const loser = winner === duel.challenger ? duel.challenged : duel.challenger;
  // restore pre-duel HP
  duel.challenger.hp = Math.max(1, duel._hpChallenger);
  duel.challenged.hp = Math.max(1, duel._hpChallenged);
  // clear transient duel statuses
  const duelStatuses = ["stun","poison","bleed","dodge","shield","mana_shield","divine_shield","arcane_exhaust","battle_cry"];
  for (const p of [duel.challenger, duel.challenged])
    p.status = p.status.filter(s => !duelStatuses.includes(s.type));
  const xp = Math.floor((loser.maxHp + loser.stats.atk * 3 + loser.stats.def * 2) / 8);
  gainXP(winner, xp);
  updateRelation(winner, loser.username,  +1, `Venció a ${loser.username} en duelo`);
  updateRelation(loser,  winner.username, -1, `Perdió contra ${winner.username} en duelo`);
  broadcast({ type: "system", text: `🏆  [Duelo] ¡${winner.username} venció a ${loser.username}! (${reason}) +${xp} XP` });
  broadcast({ type: "duel_ended", duelId: duel.id, winner: winner.username, loser: loser.username });
  game.duels.delete(duel.id);
  broadcastState();
}

function processDuelAction(duel, attacker, defender, msg) {
  const defBonus = (attacker === duel.challenger ? duel._defChallenged : duel._defChallenger) ? 1.5 : 1;
  // reset defender's defend flag
  if (attacker === duel.challenger) duel._defChallenged = false; else duel._defChallenger = false;

  if (msg.action === "defend") {
    if (attacker === duel.challenger) duel._defChallenger = true; else duel._defChallenged = true;
    broadcast({ type: "system", text: `🛡️  [Duelo] ${attacker.username} se defiende` });
    broadcastDuelState(duel);
    advanceDuelTurn(duel);
    return;
  }

  if (msg.action === "attack") {
    let dmg = Math.max(1, attacker.stats.atk - Math.floor(defender.stats.def * 0.5 * defBonus));
    const isCrit = Math.random() * 100 < attacker.stats.crit;
    if (isCrit) dmg = Math.floor(dmg * 1.5);
    defender.hp = Math.max(0, defender.hp - dmg);
    broadcast({ type: "system", text: `${attacker.emoji || "⚔️"}  [Duelo] ${attacker.username} ataca a ${defender.username} por ${dmg}${isCrit ? " 💥CRÍTICO!" : ""} (HP: ${defender.hp}/${defender.maxHp})` });
    if (defender.hp <= 0) { endDuel(duel, attacker, "combate"); return; }
    broadcastDuelState(duel);
    advanceDuelTurn(duel);
    return;
  }

  if (msg.action === "skill") {
    const skillDef = getPlayerAllSkills(attacker)[msg.skill];
    if (!skillDef) return send(attacker.ws, { type: "error", text: "Habilidad inválida" });
    if (skillDef.condition && !skillDef.condition(attacker))
      return send(attacker.ws, { type: "error", text: `No puedes usar ${skillDef.name} ahora` });

    // Healing → self
    if (skillDef.heal || skillDef.aoeHeal) {
      const amt = skillDef.heal(attacker.stats);
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + amt);
      broadcast({ type: "system", text: `✨  [Duelo] ${attacker.username} usa ${skillDef.name} → +${amt} HP (${attacker.hp}/${attacker.maxHp})` });
      broadcastDuelState(duel); advanceDuelTurn(duel); return;
    }

    // Revive → no-op in duel
    if (skillDef.effect === "revive") {
      broadcast({ type: "system", text: `[Duelo] ${skillDef.name} no tiene efecto en duelo` });
      broadcastDuelState(duel); advanceDuelTurn(duel); return;
    }

    // Effect-only (no damage)
    if (!skillDef.damage && !skillDef.aoe) {
      if (skillDef.effect === "dodge")         attacker.status.push({ type: "dodge", turns: 1 });
      if (skillDef.effect === "shield")        { const v = skillDef.value(attacker.stats); attacker.stats.def += v; attacker.status.push({ type: "shield", value: v, turns: 2 }); }
      if (skillDef.effect === "mana_shield")   attacker.status.push({ type: "mana_shield", turns: 2 });
      if (skillDef.effect === "divine_shield") attacker.status.push({ type: "divine_shield", turns: 1 });
      if (skillDef.effect === "battle_cry")    { const v = skillDef.value(attacker.stats); attacker.stats.atk += v; attacker.status.push({ type: "battle_cry", value: v, turns: 3 }); }
      broadcast({ type: "system", text: `✨  [Duelo] ${attacker.username} usa ${skillDef.name}` });
      broadcastDuelState(duel); advanceDuelTurn(duel); return;
    }

    // Damage skill
    let dmg = skillDef.damage(attacker.stats);
    const isCrit = skillDef.forceCrit || Math.random() * 100 < attacker.stats.crit;
    if (isCrit) dmg = Math.floor(dmg * (skillDef.critMult || 1.5));
    if (!skillDef.penetrate) dmg = Math.max(1, dmg - Math.floor(defender.stats.def * 0.5 * defBonus));
    // dodge check
    const dodgeIdx = defender.status.findIndex(s => s.type === "dodge");
    if (dodgeIdx >= 0) {
      defender.status.splice(dodgeIdx, 1);
      broadcast({ type: "system", text: `🌫️  [Duelo] ${defender.username} esquiva ${skillDef.name}` });
      broadcastDuelState(duel); advanceDuelTurn(duel); return;
    }
    // divine shield check
    const divineIdx = defender.status.findIndex(s => s.type === "divine_shield");
    if (divineIdx >= 0) {
      defender.status.splice(divineIdx, 1);
      broadcast({ type: "system", text: `✨  [Duelo] ${skillDef.name} bloqueado por Escudo Divino` });
      broadcastDuelState(duel); advanceDuelTurn(duel); return;
    }
    // mana shield check
    const manaIdx = defender.status.findIndex(s => s.type === "mana_shield");
    if (manaIdx >= 0) {
      const absorbed = Math.min(dmg, defender.stats.mag);
      defender.stats.mag -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0) broadcast({ type: "system", text: `🔮  [Duelo] Escudo de Maná absorbe ${absorbed} daño` });
    }
    defender.hp = Math.max(0, defender.hp - dmg);
    let fx = "";
    if (skillDef.effect === "stun")          { defender.status.push({ type: "stun", turns: 1 }); fx = " + aturde"; }
    if (skillDef.effect === "poison")        { const v = Math.floor(attacker.stats.atk * 0.2); defender.status.push({ type: "poison", value: v, turns: 3 }); fx = ` + veneno(${v}/t)`; }
    if (skillDef.effect === "bleed")         { const v = skillDef.bleedValue ? skillDef.bleedValue(attacker.stats) : Math.floor(attacker.stats.atk * 0.3); defender.status.push({ type: "bleed", value: v, turns: 5 }); fx = ` + sangrado(${v}/t)`; }
    if (skillDef.effect === "arcane_exhaust"){ attacker.stats.mag -= 10; attacker.status.push({ type: "arcane_exhaust", turns: 1 }); fx = " (−10 MAG)"; }
    broadcast({ type: "system", text: `${attacker.emoji || "⚔️"}  [Duelo] ${attacker.username} usa ${skillDef.name} → ${dmg}${isCrit ? " 💥CRÍTICO!" : ""}${fx} a ${defender.username} (HP: ${defender.hp}/${defender.maxHp})` });
    if (defender.hp <= 0) { endDuel(duel, attacker, "combate"); return; }
    broadcastDuelState(duel);
    advanceDuelTurn(duel);
  }
}

function handleDuel(ws, msg) {
  const player = game.players.get(ws);
  if (!player) return send(ws, { type: "error", text: "Primero elige una clase para dueling" });

  if (msg.action === "challenge") {
    if (getDuelForPlayer(player)) return send(ws, { type: "error", text: "Ya estás en un duelo" });
    if (game.phase === "combat") return send(ws, { type: "error", text: "No puedes dueling durante combate grupal" });
    const target = findPlayerByName(msg.target);
    if (!target)          return send(ws, { type: "error", text: `Jugador "${msg.target}" no encontrado` });
    if (target === player) return send(ws, { type: "error", text: "No puedes retarte a ti mismo" });
    if (getDuelForPlayer(target)) return send(ws, { type: "error", text: `${target.username} ya está en un duelo` });
    const duelId = `duel_${Date.now()}`;
    const timeout = setTimeout(() => {
      const d = game.duels.get(duelId);
      if (d?.status === "pending") {
        game.duels.delete(duelId);
        broadcast({ type: "system", text: `⚔️  El duelo de ${player.username} a ${target.username} expiró` });
        broadcast({ type: "duel_expired", duelId });
      }
    }, 30000);
    game.duels.set(duelId, { id: duelId, challenger: player, challenged: target, status: "pending", turnOrder: [], turnIndex: 0, timeout, _hpChallenger: 0, _hpChallenged: 0, _defChallenger: false, _defChallenged: false });
    broadcast({ type: "system", text: `⚔️  ${player.username} desafía a ${target.username} a un duelo` });
    send(target.ws, { type: "duel_challenge", duelId, challenger: player.username });
    return;
  }

  if (msg.action === "accept" || msg.action === "reject") {
    let duel = null;
    for (const [, d] of game.duels) if (d.challenged === player && d.status === "pending") { duel = d; break; }
    if (!duel) return send(ws, { type: "error", text: "No tienes desafíos pendientes" });
    clearTimeout(duel.timeout);
    if (msg.action === "reject") {
      game.duels.delete(duel.id);
      broadcast({ type: "system", text: `❌  ${player.username} rechazó el duelo de ${duel.challenger.username}` });
      send(duel.challenger.ws, { type: "duel_rejected", challenger: duel.challenger.username, target: player.username });
      return;
    }
    duel.status = "active";
    duel._hpChallenger = duel.challenger.hp;
    duel._hpChallenged = duel.challenged.hp;
    duel.turnOrder = [duel.challenger, duel.challenged].sort((a, b) => b.stats.spd - a.stats.spd);
    duel.turnIndex = 0;
    broadcast({ type: "system", text: `⚔️  ¡DUELO! ${duel.challenger.username} vs ${duel.challenged.username} — Orden: ${duel.turnOrder.map(p => p.username).join(" → ")}` });
    broadcast({ type: "duel_started", duelId: duel.id, challenger: duel.challenger.username, challenged: duel.challenged.username });
    notifyDuelTurn(duel);
    return;
  }

  if (msg.action === "forfeit") {
    const duel = getDuelForPlayer(player);
    if (!duel || duel.status !== "active") return;
    const winner = player === duel.challenger ? duel.challenged : duel.challenger;
    endDuel(duel, winner, "rendición");
    return;
  }

  // Combat actions
  if (["attack", "skill", "defend"].includes(msg.action)) {
    const duel = getDuelForPlayer(player);
    if (!duel || duel.status !== "active") return send(ws, { type: "error", text: "No estás en un duelo activo" });
    if (duel.turnOrder[duel.turnIndex] !== player) return send(ws, { type: "error", text: "No es tu turno en el duelo" });
    const opponent = player === duel.challenger ? duel.challenged : duel.challenger;
    processDuelAction(duel, player, opponent, msg);
  }
}

// ── CONEXIÓN ──────────────────────────────────────────────────────────────────

wss.on("connection", (ws) => {
  ws.username = null;
  ws.isGM = false;

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === "join")         return handleJoin(ws, msg);
    if (msg.type === "choose_class") return handleChooseClass(ws, msg);
    if (msg.type === "gm")           return handleGM(ws, msg);
    if (msg.type === "action")       return handleAction(ws, msg);
    if (msg.type === "duel")         return handleDuel(ws, msg);

    if (msg.type === "set_title") {
      const player = game.players.get(ws);
      if (!player) return;
      if (msg.prefix !== undefined) player.prefix = (msg.prefix || "").slice(0, 30) || null;
      if (msg.suffix !== undefined) player.suffix = (msg.suffix || "").slice(0, 30) || null;
      broadcastState();
      return;
    }

    if (msg.type === "peek_inventory") {
      const target = findPlayerByName(msg.username)
        || [...game.offlinePlayers.values()].find(p => p.username.toLowerCase() === (msg.username || "").toLowerCase());
      if (!target) return send(ws, { type: "error", text: "Jugador no encontrado" });
      const inv = (target.inventory || []).map(i => ({ id: i.id, name: i.name, type: i.type, rarity: i.rarity, level: i.level, stats: i.stats }));
      const eq = {
        weapon:    target.equipment?.weapon    ? { name: target.equipment.weapon.name,    rarity: target.equipment.weapon.rarity,    stats: target.equipment.weapon.stats    } : null,
        armor:     target.equipment?.armor     ? { name: target.equipment.armor.name,     rarity: target.equipment.armor.rarity,     stats: target.equipment.armor.stats     } : null,
        accessory: target.equipment?.accessory ? { name: target.equipment.accessory.name, rarity: target.equipment.accessory.rarity, stats: target.equipment.accessory.stats } : null,
      };
      const relations = Object.entries(target.relations || {}).map(([u, r]) => ({
        username: u, affinity: r.affinity, history: r.history,
      })).sort((a, b) => Math.abs(b.affinity) - Math.abs(a.affinity));
      send(ws, {
        type: "character_sheet",
        username: target.username,
        classKey: target.classKey,
        className: target.className,
        emoji: target.emoji,
        level: target.level,
        xp: target.xp,
        xpToNext: XP_PER_LEVEL[Math.min(target.level, XP_PER_LEVEL.length - 1)] || 0,
        xpCurrent: XP_PER_LEVEL[target.level - 1] || 0,
        gold: target.gold || 0,
        hp: target.hp, maxHp: target.maxHp,
        stats: { ...target.stats },
        status: (target.status || []).map(s => ({ type: s.type, turns: s.turns })),
        equipment: eq,
        inventory: inv,
        relations,
        offline: !!(target.offline),
        prefix: target.prefix || null,
        suffix: target.suffix || null,
      });
      return;
    }

    if (msg.type === "rename") {
      const old = ws.username;
      ws.username = msg.newUsername;
      const p = game.players.get(ws);
      if (p) { p.username = msg.newUsername; const ti = game.turnOrder.find(t => t.name === old); if (ti) ti.name = msg.newUsername; }
      broadcast({ type: "system", text: `${old} ahora se llama ${msg.newUsername}` });
      broadcast({ type: "users", users: onlineUsers() });
      broadcastState();
      return;
    }

    if (msg.type === "message") {
      broadcast({ type: "message", username: ws.username, text: msg.text });
      return;
    }

    if (msg.type === "vote") {
      const player = game.players.get(ws);
      if (!player) return;
      const vote = game.activeVote;
      if (!vote || vote.resolved) return send(ws, { type: "error", text: "No hay votación activa" });
      if (vote.phase !== "need_greed") return send(ws, { type: "error", text: "Usa /voteitem — el sistema actual es Consejo" });
      if (!["need","greed","pass"].includes(msg.action)) return send(ws, { type: "error", text: "Opciones: need | greed | pass" });
      if (vote.votes.has(player.username)) return send(ws, { type: "error", text: "Ya votaste" });
      vote.votes.set(player.username, msg.action);
      const total = activePlayers().length;
      const ng = { need: 0, greed: 0, pass: 0 };
      for (const v of vote.votes.values()) if (ng[v] !== undefined) ng[v]++;
      broadcast({ type: "vote_update", votedCount: vote.votes.size, totalCount: total, breakdown: ng });
      broadcast({ type: "system", text: `🗳️  ${player.username} votó (${vote.votes.size}/${total})` });
      checkAutoResolve();
      return;
    }

    if (msg.type === "voteitem") {
      const player = game.players.get(ws);
      if (!player) return;
      const vote = game.activeVote;
      if (!vote || vote.resolved) return send(ws, { type: "error", text: "No hay votación activa" });
      if (vote.phase !== "council") return send(ws, { type: "error", text: "Usa /vote — el sistema actual es Need/Greed/Pass" });
      if (vote.votes.has(player.username)) return send(ws, { type: "error", text: "Ya votaste" });
      const target = findPlayerByName(msg.target);
      if (!target) return send(ws, { type: "error", text: `Jugador "${msg.target}" no encontrado` });
      vote.votes.set(player.username, target.username);
      const total = activePlayers().length;
      const councilTally = {};
      for (const v of vote.votes.values()) councilTally[v] = (councilTally[v] || 0) + 1;
      broadcast({ type: "vote_update", votedCount: vote.votes.size, totalCount: total, council: councilTally });
      broadcast({ type: "system", text: `🗳️  ${player.username} votó (${vote.votes.size}/${total})` });
      checkAutoResolve();
      return;
    }

    if (msg.type === "equip") {
      const player = game.players.get(ws);
      if (!player) return;
      const itemIdx = player.inventory.findIndex(i => i.id === msg.itemId);
      if (itemIdx < 0) return send(ws, { type: "error", text: "Objeto no en inventario" });
      const item = player.inventory[itemIdx];
      const slot = item.type;
      if (!["weapon", "armor", "accessory"].includes(slot)) return send(ws, { type: "error", text: "Slot inválido" });
      if (player.equipment[slot]) player.inventory.push(player.equipment[slot]);
      player.equipment[slot] = item;
      player.inventory.splice(itemIdx, 1);
      recalcStats(player);
      broadcast({ type: "system", text: `⚙️ ${player.username} equipó ${item.name}` });
      sendInventory(ws, player);
      broadcastState();
      return;
    }

    if (msg.type === "unequip") {
      const player = game.players.get(ws);
      if (!player) return;
      const item = player.equipment[msg.slot];
      if (!item) return;
      player.inventory.push(item);
      player.equipment[msg.slot] = null;
      recalcStats(player);
      broadcast({ type: "system", text: `⚙️ ${player.username} desequipó ${item.name}` });
      sendInventory(ws, player);
      broadcastState();
      return;
    }

    if (msg.type === "drop_item") {
      const player = game.players.get(ws);
      if (!player) return;
      const itemIdx = player.inventory.findIndex(i => i.id === msg.itemId);
      if (itemIdx < 0) return send(ws, { type: "error", text: "Objeto no encontrado" });
      const [item] = player.inventory.splice(itemIdx, 1);
      broadcast({ type: "system", text: `🗑️ ${player.username} descartó ${item.name}` });
      sendInventory(ws, player);
      return;
    }

    if (msg.type === "shop_buy") {
      const player = game.players.get(ws);
      if (!player) return;
      if (!game.shop) return send(ws, { type: "error", text: "No hay tienda abierta" });
      const itemIdx = game.shop.items.findIndex(i => i.id === msg.itemId);
      if (itemIdx < 0) return send(ws, { type: "error", text: "Objeto no disponible" });
      const shopItem = game.shop.items[itemIdx];
      if ((player.gold || 0) < shopItem.price) return send(ws, { type: "error", text: `Oro insuficiente — necesitas ${shopItem.price}` });
      player.gold -= shopItem.price;
      const { price: _p, ...purchased } = shopItem;
      player.inventory.push(purchased);
      game.shop.items.splice(itemIdx, 1);
      broadcast({ type: "system", text: `🛒 ${player.username} compró ${shopItem.name} por ${shopItem.price} 💰` });
      broadcast({ type: "shop_update", items: game.shop.items });
      sendInventory(ws, player);
      send(ws, { type: "gold_update", gold: player.gold });
      broadcastState();
      return;
    }

    if (msg.type === "sell_item") {
      const player = game.players.get(ws);
      if (!player) return;
      if (!game.shop) return send(ws, { type: "error", text: "No hay tienda abierta para vender" });
      const itemIdx = player.inventory.findIndex(i => i.id === msg.itemId);
      if (itemIdx < 0) return send(ws, { type: "error", text: "Objeto no encontrado en inventario" });
      const [item] = player.inventory.splice(itemIdx, 1);
      const sellPrice = Math.floor(shopPrice(item) * 0.35);
      player.gold = (player.gold || 0) + sellPrice;
      broadcast({ type: "system", text: `💰 ${player.username} vendió ${item.name} por ${sellPrice} monedas` });
      sendInventory(ws, player);
      send(ws, { type: "gold_update", gold: player.gold });
      broadcastState();
      return;
    }

    if (msg.type === "dialog_choice") {
      const player = game.players.get(ws);
      if (!player || !game.dialog) return;
      const opts = game.dialog.options || [];
      const idx = typeof msg.index === "number" ? msg.index : -1;
      if (idx < 0 || idx >= opts.length) return;
      game.dialog.votes[player.username] = idx;
      // Build vote tally for each option
      const tally = opts.map((_, i) =>
        Object.values(game.dialog.votes).filter(v => v === i).length
      );
      broadcast({ type: "dialog_vote_update", votes: game.dialog.votes, tally });
      broadcast({ type: "message", username: player.username, text: `[dice a ${game.dialog.npc}] ${opts[idx]}` });
      if (game.gm) send(game.gm, { type: "dialog_response", player: player.username, option: idx, text: opts[idx] });
      return;
    }
  });

  ws.on("close", () => {
    if (ws.username) {
      broadcast({ type: "system", text: `${ws.username} salió` });
      // cancel active duels
      const player = game.players.get(ws);
      if (player) {
        const duel = getDuelForPlayer(player);
        if (duel) {
          if (duel.status === "active") {
            const winner = player === duel.challenger ? duel.challenged : duel.challenger;
            endDuel(duel, winner, "desconexión");
          } else {
            clearTimeout(duel.timeout);
            game.duels.delete(duel.id);
            broadcast({ type: "duel_expired", duelId: duel.id });
          }
        }
      }
      // Save player data for reconnect if adventure is active
      if (player && game.phase !== "lobby") {
        game.offlinePlayers.set(player.username, player);
      }
      game.players.delete(ws);
      game.turnOrder = game.turnOrder.filter(t => !(t.type === "player" && t.name === ws.username));
      if (game.turnIndex >= game.turnOrder.length) game.turnIndex = 0;
      if (ws === game.gm) {
        game.gm = null;
        broadcast({ type: "system", text: "👑 El GM se desconectó — la mesa se reinicia" });
        resetGameTable();
        broadcastState();
      }
      broadcast({ type: "users", users: onlineUsers() });

      // If no one is left, full wipe
      const anyConnected = [...wss.clients].some(c => c.readyState === 1 && c.username);
      if (!anyConnected) {
        clearTurnReminder();
        if (game.activeVote) { clearTimeout(game.activeVote.timeout); }
        for (const [, d] of game.duels) { clearTimeout(d.timeout); clearDuelReminder(d); }
        game.phase          = "lobby";
        game.scenario       = null;
        game.enemies        = [];
        game.turnOrder      = [];
        game.turnIndex      = 0;
        game.lootQueue      = [];
        game.activeVote     = null;
        game.lootMode       = "need_greed";
        game.duels          = new Map();
        game.shop           = null;
        game.dialog         = null;
        game.players        = new Map();
        game.offlinePlayers = new Map();
        game.gm             = null;
        console.log("Todos se desconectaron — mesa limpia");
      } else if (ws !== game.gm) {
        broadcastState();
      }
    }
  });
});

server.listen(3000, () => console.log("Servidor en http://localhost:3000"));
