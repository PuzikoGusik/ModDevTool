/**
 * ModDevTool — Datapack builder
 * © 2026 Puziko & Beliash. All rights reserved.
 *
 * Строит датапак по состоянию конструктора. Учитывает отличия форматов:
 *   pack_format >= 48 (1.21)   — каталоги в единственном числе (recipe, loot_table, function ...)
 *   pack_format >= 41 (1.20.5) — результат рецепта {id,count}, иконка достижения {id}
 *   pack_format >= 57 (1.21.2) — ингредиент записывается строкой "minecraft:x" / "#tag"
 *
 * MDTDatapack.plan(state, opts)  -> { files: {path: string}, warnings: [], namespace }
 * MDTDatapack.build(state, opts, JSZip) -> Promise<{ blob, filename, files, warnings, namespace }>
 */
(function (global) {
  'use strict';

  const TRANSLIT = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'j','к':'k','л':'l','м':'m',
    'н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'shch',
    'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya','і':'i','ї':'yi','є':'ye','ґ':'g'
  };

  /** Допустимый сегмент ресурс-локации: [a-z0-9_.-]. Кириллица транслитерируется. */
  function slug(raw, fallback) {
    const s = String(raw == null ? '' : raw)
      .toLowerCase()
      .replace(/[а-яёіїєґ]/g, ch => TRANSLIT[ch] || '')
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_.-]/g, '')
      .replace(/_+/g, '_')
      .replace(/^[_.-]+|[_.-]+$/g, '');
    return s || fallback || 'untitled';
  }

  /** Путь внутри пространства имён: сегменты через "/", каждый — slug. */
  function slugPath(raw, fallback) {
    const parts = String(raw == null ? '' : raw).split('/').map(p => slug(p, '')).filter(Boolean);
    return parts.length ? parts.join('/') : (fallback || 'untitled');
  }

  function era(format) {
    const f = Number(format) || 48;
    return {
      format: f,
      singular: f >= 48,        // recipes -> recipe и т.д.
      resultId: f >= 41,        // {id,count} вместо {item,count}
      iconId: f >= 41,          // icon {id} вместо {item}
      ingredientString: f >= 57,// "minecraft:x" вместо {item:"minecraft:x"}
      macros: f >= 18           // $-макросы в функциях (1.20.2+)
    };
  }

  /** "iron_ingot" -> "minecraft:iron_ingot"; "#logs" -> "#minecraft:logs"; null при некорректном id. */
  function normalizeId(raw) {
    let s = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!s) return null;
    let tag = false;
    if (s[0] === '#') { tag = true; s = s.slice(1); }
    if (!s.includes(':')) s = 'minecraft:' + s;
    if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(s)) return null;
    return (tag ? '#' : '') + s;
  }

  function ingredient(id, E) {
    if (E.ingredientString) return id;
    return id[0] === '#' ? { tag: id.slice(1) } : { item: id };
  }

  function resultStack(id, count, E) {
    return E.resultId ? { id, count } : { item: id, count };
  }

  const COOKING = {
    smelting:         { experience: 0.35, time: 200 },
    blasting:         { experience: 0.35, time: 100 },
    smoking:          { experience: 0.35, time: 100 },
    campfire_cooking: { experience: 0.35, time: 600 }
  };

  const LOOT = {
    chest:   { type: 'minecraft:chest',   dir: 'chests',   file: 'custom_chest' },
    entity:  { type: 'minecraft:entity',  dir: 'entities', file: 'custom_entity' },
    block:   { type: 'minecraft:block',   dir: 'blocks',   file: 'custom_block' },
    fishing: { type: 'minecraft:fishing', dir: 'gameplay', file: 'custom_fishing' }
  };

  function clampInt(v, def, min, max) {
    let n = Math.floor(Number(v));
    if (!isFinite(n)) n = def;
    return Math.min(max, Math.max(min, n));
  }

  // ───────────── Рецепты ─────────────
  function buildRecipe(r, E, warn, label) {
    const type = String(r.type || 'crafting_shaped');
    const result = normalizeId(r.result);
    if (!result || result[0] === '#') { warn(`${label}: некорректный результат «${r.result}» — рецепт пропущен.`); return null; }
    const count = clampInt(r.count, 1, 1, 64);
    const slots = (r.slots || []).slice(0, 9).map(s => (s ? normalizeId(s) : null));
    while (slots.length < 9) slots.push(null);
    const filled = slots.filter(Boolean);
    if (!filled.length) { warn(`${label}: нет ингредиентов — рецепт пропущен.`); return null; }

    if (type === 'crafting_shaped') {
      // Ключи — буквы A, B, C… по порядку появления разных ингредиентов.
      const letters = 'ABCDEFGHI';
      const keyOf = new Map();
      slots.forEach(id => { if (id && !keyOf.has(id)) keyOf.set(id, letters[keyOf.size]); });
      // Обрезка пустых строк/столбцов: шаблон должен быть минимальным прямоугольником.
      const rows = [0, 1, 2].map(y => [0, 1, 2].map(x => slots[y * 3 + x]));
      const usedRows = [0, 1, 2].filter(y => rows[y].some(Boolean));
      const usedCols = [0, 1, 2].filter(x => rows.some(row => row[x]));
      const y0 = Math.min(...usedRows), y1 = Math.max(...usedRows);
      const x0 = Math.min(...usedCols), x1 = Math.max(...usedCols);
      const pattern = [];
      for (let y = y0; y <= y1; y++) {
        let line = '';
        for (let x = x0; x <= x1; x++) line += rows[y][x] ? keyOf.get(rows[y][x]) : ' ';
        pattern.push(line);
      }
      const key = {};
      keyOf.forEach((letter, id) => { key[letter] = ingredient(id, E); });
      return { type: 'minecraft:crafting_shaped', category: 'misc', pattern, key, result: resultStack(result, count, E) };
    }

    if (type === 'crafting_shapeless') {
      return {
        type: 'minecraft:crafting_shapeless',
        category: 'misc',
        ingredients: filled.map(id => ingredient(id, E)),
        result: resultStack(result, count, E)
      };
    }

    if (COOKING[type]) {
      const d = COOKING[type];
      if (filled.length > 1) warn(`${label}: для «${type}» нужен один ингредиент — взят первый.`);
      if (!E.resultId && count > 1) warn(`${label}: до 1.20.5 печи не поддерживают количество результата — будет 1.`);
      const exp = Number.isFinite(Number(r.experience)) && r.experience !== '' && r.experience != null ? Math.max(0, Number(r.experience)) : d.experience;
      const time = clampInt(r.cookingtime, d.time, 1, 100000);
      return {
        type: 'minecraft:' + type,
        category: 'misc',
        ingredient: ingredient(filled[0], E),
        result: E.resultId ? { id: result, count } : result,
        experience: exp,
        cookingtime: time
      };
    }

    if (type === 'stonecutting') {
      if (filled.length > 1) warn(`${label}: для камнереза нужен один ингредиент — взят первый.`);
      return E.resultId
        ? { type: 'minecraft:stonecutting', ingredient: ingredient(filled[0], E), result: { id: result, count } }
        : { type: 'minecraft:stonecutting', ingredient: ingredient(filled[0], E), result, count };
    }

    warn(`${label}: неизвестный тип «${type}» — рецепт пропущен.`);
    return null;
  }

  // ───────────── Лут ─────────────
  function buildLoot(entries, E, warn) {
    const groups = {};
    entries.forEach((l, i) => {
      const t = LOOT[l.type] ? l.type : 'chest';
      const item = normalizeId(l.item);
      if (!item || item[0] === '#') { warn(`Лут #${i + 1}: некорректный предмет «${l.item}» — пропущен.`); return; }
      (groups[t] = groups[t] || []).push({
        item,
        min: clampInt(l.min, 1, 0, 64),
        max: clampInt(l.max, 1, 0, 64),
        weight: clampInt(l.weight, 1, 1, 1000)
      });
    });
    const out = [];
    Object.keys(groups).forEach(t => {
      const def = LOOT[t];
      const entriesJson = groups[t].map(e => {
        const lo = Math.min(e.min, e.max), hi = Math.max(e.min, e.max);
        const count = lo === hi ? lo : { type: 'minecraft:uniform', min: lo, max: hi };
        return {
          type: 'minecraft:item',
          name: e.item,
          weight: e.weight,
          functions: [{ function: 'minecraft:set_count', count }]
        };
      });
      out.push({ def, json: { type: def.type, pools: [{ rolls: 1, entries: entriesJson }] } });
    });
    return out;
  }

  // ───────────── Достижения ─────────────
  function advCriteria(a, E, warn, label) {
    const trigger = String(a.trigger || 'impossible');
    const target = a.target ? normalizeId(a.target) : null;
    if (a.target && !target) warn(`${label}: некорректный id цели «${a.target}» — условие не добавлено.`);
    switch (trigger) {
      case 'tick':
        return { c: { trigger: 'minecraft:tick' } };
      case 'inventory_changed': {
        const item = target || normalizeId(a.icon);
        return { c: item
          ? { trigger: 'minecraft:inventory_changed', conditions: { items: [{ items: [item] }] } }
          : { trigger: 'minecraft:inventory_changed' } };
      }
      case 'player_killed_entity':
        return { c: target
          ? { trigger: 'minecraft:player_killed_entity', conditions: { entity: [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: target } }] } }
          : { trigger: 'minecraft:player_killed_entity' } };
      case 'enter_block':
        return { c: target
          ? { trigger: 'minecraft:enter_block', conditions: { block: target } }
          : { trigger: 'minecraft:enter_block' } };
      default:
        return { c: { trigger: 'minecraft:impossible' } };
    }
  }

  // ───────────── plan ─────────────
  function plan(state, opts) {
    state = state || {};
    opts = opts || {};
    const warnings = [];
    const warn = m => warnings.push(m);
    const E = era(opts.format);
    const ns = slug(opts.name, 'my_datapack').replace(/\./g, '_');
    const D = {
      recipe: E.singular ? 'recipe' : 'recipes',
      loot: E.singular ? 'loot_table' : 'loot_tables',
      adv: E.singular ? 'advancement' : 'advancements',
      fn: E.singular ? 'function' : 'functions',
      tagFn: E.singular ? 'tags/function' : 'tags/functions'
    };
    const files = {};
    const put = (path, content) => { files[path] = typeof content === 'string' ? content : JSON.stringify(content, null, 2); };
    const usedPaths = new Set();
    const uniquePath = (dir, base) => {
      let p = base, n = 2;
      while (usedPaths.has(dir + '/' + p)) p = `${base}_${n++}`;
      usedPaths.add(dir + '/' + p);
      return p;
    };

    const description = String(opts.description || `${opts.name || ns} — создано в ModDevTool`).slice(0, 200);
    put('pack.mcmeta', { pack: { pack_format: E.format, description } });

    // Рецепты
    (state.recipes || []).forEach((r, i) => {
      const json = buildRecipe(r, E, warn, `Рецепт #${i + 1}`);
      if (!json) return;
      const resId = normalizeId(r.result);
      const base = slugPath(resId.split(':')[1].replace(/\//g, '_') + '_' + (r.type === 'crafting_shapeless' ? 'shapeless' : (r.type || 'shaped').replace('crafting_', '')), 'recipe');
      put(`data/${ns}/${D.recipe}/${uniquePath(D.recipe, base)}.json`, json);
    });

    // Лут
    buildLoot(state.loot || [], E, warn).forEach(({ def, json }) => {
      put(`data/${ns}/${D.loot}/${def.dir}/${def.file}.json`, json);
    });

    // Функции
    const fnLoad = [], fnTick = [];
    (state.functions || []).forEach((f, i) => {
      const nm = slugPath(f.name, `function_${i + 1}`);
      const p = uniquePath(D.fn, nm);
      let body = String(f.body == null ? '' : f.body).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, '')).join('\n');
      if (!body.trim()) { body = `# ${ns}:${p}`; warn(`Функция «${f.name}» пуста — добавлен комментарий.`); }
      if (!E.macros && /^\s*\$/m.test(body)) warn(`Функция «${f.name}»: макросы ($) работают только с 1.20.2 (pack_format 18+).`);
      if (/^\s*\//m.test(body)) warn(`Функция «${f.name}»: команды в .mcfunction пишутся без начального «/».`);
      put(`data/${ns}/${D.fn}/${p}.mcfunction`, body.endsWith('\n') ? body : body + '\n');
      if (f.run === 'load') fnLoad.push(`${ns}:${p}`);
      else if (f.run === 'tick') fnTick.push(`${ns}:${p}`);
    });
    if (fnLoad.length) put(`data/minecraft/${D.tagFn}/load.json`, { replace: false, values: fnLoad });
    if (fnTick.length) put(`data/minecraft/${D.tagFn}/tick.json`, { replace: false, values: fnTick });

    // Достижения: корневое + дочерние
    const advs = state.advancements || [];
    if (advs.length) {
      const firstIcon = normalizeId(advs[0].icon) || 'minecraft:grass_block';
      const iconOf = id => (E.iconId ? { id } : { item: id });
      put(`data/${ns}/${D.adv}/root.json`, {
        display: {
          icon: iconOf(firstIcon),
          title: String(opts.name || ns),
          description: description,
          background: 'minecraft:textures/gui/advancements/backgrounds/stone.png',
          show_toast: false,
          announce_to_chat: false
        },
        criteria: { auto: { trigger: 'minecraft:tick' } }
      });
      usedPaths.add(D.adv + '/root');
      const FRAMES = ['task', 'goal', 'challenge'];
      advs.forEach((a, i) => {
        const label = `Достижение #${i + 1}`;
        const icon = normalizeId(a.icon);
        if (!icon) warn(`${label}: некорректная иконка «${a.icon}» — использован алмаз.`);
        const { c } = advCriteria(a, E, warn, label);
        const frame = FRAMES.includes(a.frame) ? a.frame : 'task';
        const json = {
          parent: `${ns}:root`,
          display: {
            icon: iconOf(icon || 'minecraft:diamond'),
            title: String(a.title || `Достижение ${i + 1}`).slice(0, 80),
            description: String(a.desc || '').slice(0, 200),
            frame,
            show_toast: true,
            announce_to_chat: true,
            hidden: false
          },
          criteria: { requirement: c }
        };
        if (a.reward && String(a.reward).trim()) {
          const rf = slugPath(a.reward, '');
          const known = (state.functions || []).some(f => slugPath(f.name, '') === rf);
          if (!known) warn(`${label}: функция награды «${a.reward}» не найдена среди функций пака.`);
          json.rewards = { function: a.reward.includes(':') ? a.reward : `${ns}:${rf}` };
        }
        const base = slugPath(a.title, `advancement_${i + 1}`);
        put(`data/${ns}/${D.adv}/${uniquePath(D.adv, base)}.json`, json);
      });
    }

    const count = Object.keys(files).length - 1;
    if (count <= 0) warn('Датапак пуст: добавь хотя бы один рецепт, лут, достижение или функцию.');

    // README
    const lines = [
      `${opts.name || ns}`,
      '='.repeat(String(opts.name || ns).length),
      '',
      `Namespace: ${ns}`,
      `pack_format: ${E.format}`,
      '',
      'Установка:',
      '  1. Положите этот .zip (не распаковывая) в папку  <мир>/datapacks/',
      '  2. В игре выполните  /reload  (или перезайдите в мир)',
      '  3. Проверка: /datapack list',
      ''
    ];
    const nFn = (state.functions || []).length;
    if (nFn) {
      lines.push('Функции:');
      (state.functions || []).forEach((f, i) => {
        const p = slugPath(f.name, `function_${i + 1}`);
        lines.push(`  /function ${ns}:${p}${f.run === 'load' ? '   (автозапуск при /reload и входе в мир)' : f.run === 'tick' ? '   (каждый тик)' : ''}`);
      });
      lines.push('');
    }
    if (advs.length) lines.push('Достижения:', `  /advancement grant @s only ${ns}:<имя>   (для «impossible» — выдаётся только командой)`, '');
    if (Object.keys(files).some(f => f.includes('/chests/'))) lines.push('Лут:', `  /loot give @s loot ${ns}:chests/custom_chest`, '');
    put('README_MDT.txt', lines.join('\n'));

    return { files, warnings, namespace: ns, format: E.format };
  }

  async function build(state, opts, JSZip) {
    if (!JSZip) throw new Error('JSZip is required');
    const p = plan(state, opts);
    const zip = new JSZip();
    Object.keys(p.files).forEach(path => zip.file(path, p.files[path]));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' });
    return { blob, filename: `${p.namespace}.zip`, files: Object.keys(p.files), warnings: p.warnings, namespace: p.namespace };
  }

  global.MDTDatapack = { plan, build, slug, slugPath, normalizeId, era, version: '1.0.0' };
})(typeof window !== 'undefined' ? window : globalThis);
