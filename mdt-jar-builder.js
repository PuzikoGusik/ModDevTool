/**
 * ModDevTool — JAR / project builder (private module)
 * © 2026 Puziko & Beliash. All rights reserved.
 * Not open source. Redistribution prohibited without written consent.
 *
 * Browser cannot emit JVM bytecode. This module builds a complete,
 * Gradle-ready mod project (sources + assets + metadata) packaged as .jar/.zip.
 * After one local `gradlew build` the output in build/libs is a loadable mod.
 *
 * Поддерживаемые цели (см. PROFILES): Forge 1.20.1 / 1.20.4 / 1.21.1,
 * NeoForge 1.21.1, Fabric (и Quilt через Fabric) 1.20.1 / 1.20.4 / 1.21.1.
 * Для остальных версий Minecraft берётся ближайший профиль, о чём сообщается
 * в README проекта и в blob.mdtNote.
 */
(function (global) {
  'use strict';

  const APP_VERSION = '7.2.0';
  const LOOM_VERSION = '1.7.4';
  const FABRIC_LOADER_VERSION = '0.16.9';
  const FOOJAY_VERSION = '0.8.0';

  /** Версии зависимостей. era: 'old' = 1.20.x, 'new' = 1.21.x (другой API и другие имена папок data). */
  const PROFILES = {
    forge: {
      '1.20.1': { era: 'old', java: 17, pack: 15, forge: '47.3.0',  loader: 47 },
      '1.20.4': { era: 'old', java: 17, pack: 26, forge: '49.0.30', loader: 49 },
      '1.21.1': { era: 'new', java: 21, pack: 34, forge: '52.0.0',  loader: 52 }
    },
    neoforge: {
      '1.21.1': { era: 'new', java: 21, pack: 34, neo: '21.1.92', mdg: '2.0.141' }
    },
    fabric: {
      '1.20.1': { era: 'old', java: 17, pack: 15, api: '0.92.2+1.20.1' },
      '1.20.4': { era: 'old', java: 17, pack: 26, api: '0.97.3+1.20.4' },
      '1.21.1': { era: 'new', java: 21, pack: 34, api: '0.110.0+1.21.1' }
    }
  };

  const JAVA_RESERVED = new Set(('abstract assert boolean break byte case catch char class const continue default do ' +
    'double else enum extends final finally float for goto if implements import instanceof int interface long native ' +
    'new package private protected public return short static strictfp super switch synchronized this throw throws ' +
    'transient try void volatile while true false null var record yield sealed permits').split(' '));

  const TRANSLIT = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'j','к':'k','л':'l','м':'m',
    'н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'shch',
    'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya','і':'i','ї':'yi','є':'ye','ґ':'g'
  };

  function translit(str) {
    return String(str || '').toLowerCase().replace(/[а-яёіїєґ]/g, ch => TRANSLIT[ch] || '');
  }

  function cap(str) {
    str = String(str || 'Mod');
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function sanitizeModId(raw) {
    return translit(raw || 'mymod')
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/__+/g, '_')
      .replace(/^_|_$/g, '') || 'mymod';
  }

  function sanitizeId(raw) {
    return sanitizeModId(raw);
  }

  /** modid, пригодный и для Forge (^[a-z][a-z0-9_]{1,63}$), и как сегмент Java-пакета. */
  function safeModId(name) {
    let id = sanitizeModId(name);
    if (!/^[a-z]/.test(id)) id = 'mod_' + id;
    if (JAVA_RESERVED.has(id)) id += '_mod';
    id = id.slice(0, 64).replace(/_+$/, '');
    return id.length >= 2 ? id : 'mymod';
  }

  /** Одна строка без управляющих символов и опасных для Java/TOML/MANIFEST последовательностей. */
  function cleanText(raw, max, fallback) {
    const t = String(raw == null ? '' : raw)
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/[\\"`]/g, '')
      .replace(/\*\/|\/\*/g, '')
      .replace(/'{3,}/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
    return t || fallback || '';
  }

  function cleanVersion(raw) {
    return String(raw || '').replace(/[^0-9A-Za-z.+_-]/g, '').slice(0, 32) || '1.0.0';
  }

  /** .properties читаются как ISO-8859-1: всё не-ASCII записываем как \\uXXXX. */
  function propEscape(str) {
    return String(str).replace(/[^\x20-\x7e]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
  }

  function num(v, def, min, max) {
    let n = Number(v);
    if (!isFinite(n)) n = def;
    return Math.min(max, Math.max(min, n));
  }

  function mcMinor(ver) {
    const m = String(ver || '').match(/^1\.(\d+)(?:\.(\d+))?/);
    return m ? { minor: +m[1], patch: +(m[2] || 0) } : { minor: 20, patch: 1 };
  }

  function mcverToPackFormat(ver) {
    const map = {
      '1.21.5': 42, '1.21.4': 41, '1.21.1': 34, '1.21': 34,
      '1.20.6': 32, '1.20.4': 26, '1.20.2': 22, '1.20.1': 15, '1.20': 15,
      '1.19.4': 12, '1.19.2': 9, '1.18.2': 8, '1.17.1': 7, '1.16.5': 6,
      '1.15.2': 5, '1.14.4': 4, '1.12.2': 3, '1.9.4': 2, '1.8.9': 1, '1.7.10': 1
    };
    return map[ver] || 15;
  }

  function needsJava17(ver) {
    const m = String(ver || '').match(/^(\d+)\.(\d+)/);
    if (!m) return true;
    return +m[1] > 1 || (+m[1] === 1 && +m[2] >= 17);
  }

  function javaVersionFor(ver) {
    const { minor, patch } = mcMinor(ver);
    if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
    return needsJava17(ver) ? 17 : 8;
  }

  /** Подбор профиля сборки под платформу и версию Minecraft. */
  function resolveTarget(platform, ver) {
    const p = String(platform || 'Forge').toLowerCase();
    const family = p === 'neoforge' ? 'neoforge' : (p === 'fabric' || p === 'quilt') ? 'fabric' : 'forge';
    const table = PROFILES[family];
    let key = table[ver] ? ver : null;
    if (!key) {
      if (family === 'neoforge') key = '1.21.1';
      else {
        const { minor, patch } = mcMinor(ver);
        key = minor >= 21 ? '1.21.1' : (minor === 20 && patch >= 2) ? '1.20.4' : '1.20.1';
      }
    }
    return { family, key, prof: table[key], requested: ver, adjusted: key !== ver, quilt: p === 'quilt' };
  }

  /** Уникальные, валидные для Java/Minecraft id предметов (без дублей и без цифры в начале). */
  function assignItemIds(items) {
    const used = new Set();
    return items.map(it => {
      let base = sanitizeId(it.name);
      if (/^[0-9]/.test(base)) base = 'i_' + base;
      let id = base, n = 2;
      while (used.has(id)) id = `${base}_${n++}`;
      used.add(id);
      return Object.assign({}, it, { _iid: id, _base: base });
    });
  }

  // ── Текстуры: корректный PNG без зависимостей (deflate «stored»-блоки) ──
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function adler32(bytes) {
    let a = 1, b = 0;
    for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
    return ((b << 16) | a) >>> 0;
  }

  function be32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }

  function concatBytes(parts) {
    const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
    let off = 0;
    parts.forEach(a => { out.set(a, off); off += a.length; });
    return out;
  }

  function pngChunk(type, data) {
    const typeBytes = Uint8Array.from([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
    const body = concatBytes([typeBytes, data]);
    return concatBytes([Uint8Array.from(be32(data.length)), body, Uint8Array.from(be32(crc32(body)))]);
  }

  /** RGBA PNG size×size из массива пикселей. */
  function encodePng(size, rgba) {
    const stride = size * 4 + 1;
    const raw = new Uint8Array(stride * size);
    for (let y = 0; y < size; y++) {
      raw[y * stride] = 0; // filter: none
      raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * stride + 1);
    }
    const parts = [Uint8Array.from([0x78, 0x01])];
    for (let p = 0; p < raw.length; p += 65535) {
      const chunk = raw.subarray(p, Math.min(p + 65535, raw.length));
      const len = chunk.length;
      parts.push(Uint8Array.from([p + 65535 >= raw.length ? 1 : 0, len & 255, len >> 8, ~len & 255, (~len >> 8) & 255]), chunk);
    }
    parts.push(Uint8Array.from(be32(adler32(raw))));
    const ihdr = Uint8Array.from([...be32(size), ...be32(size), 8, 6, 0, 0, 0]);
    return concatBytes([
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', concatBytes(parts)),
      pngChunk('IEND', new Uint8Array(0))
    ]);
  }

  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function hslToRgb(h, s, l) {
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }

  /** Детерминированная 16×16 заглушка: цвет зависит от имени. Блок — плитка с шумом, предмет — «камень» на прозрачном фоне. */
  function textureBytes(name, isBlock) {
    const size = 16;
    const hsh = hashStr(String(name));
    const hue = hsh % 360;
    const base = hslToRgb(hue, 0.55, 0.5);
    const dark = hslToRgb(hue, 0.6, 0.28);
    const light = hslToRgb(hue, 0.5, 0.72);
    let seed = hsh || 1;
    const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    const px = new Uint8Array(size * size * 4);
    const put = (x, y, c) => { const i = (y * size + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isBlock) {
          const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
          const n = rnd();
          put(x, y, edge || n < 0.2 ? dark : n > 0.8 ? light : base);
        } else {
          const dx = x - 7.5, dy = y - 7.5, d = Math.sqrt(dx * dx + dy * dy);
          if (d > 6.5) continue; // прозрачный фон
          put(x, y, d > 5.3 ? dark : (dx + dy < -2 ? light : base));
        }
      }
    }
    return encodePng(size, px);
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ───────────────────────── Java: предметы и блоки ─────────────────────────

  function classify(type) {
    if (/sword|dagger|axe_w|bow|staff/.test(type)) return 'weapon';
    if (/helmet|chestplate|leggings|boots/.test(type)) return 'armor';
    if (/food|potion/.test(type)) return 'food';
    if (/block_ore|block_stone|block_light|block_machine|deco_/.test(type)) return 'block';
    return 'item';
  }

  /**
   * Java-выражения для предмета (и блока). blockRef — Java-выражение, возвращающее Block
   * (для Forge/NeoForge `ModBlocks.X_BLOCK.get()`, для Fabric локальная переменная).
   */
  function itemSpec(item, era) {
    const iid = item._iid;
    const type = String(item.type || 'ingot').toLowerCase();
    const kind = classify(type);
    const dmg = Math.round(num(item.dmg, 0, 0, 1000));
    const dur = Math.floor(num(item.dur, 0, 0, 1000000));
    const spd = num(item.spd, 1.0, 0.1, 10);
    const nutrition = Math.round(num(item.nutrition, 4, 0, 20));
    const saturation = num(item.saturation, 0.3, 0, 20);
    const hardness = num(item.hardness, 1.5, 0, 1000);
    const stack = Math.round(num(item.stacksize, 64, 1, 64));
    const field = iid.toUpperCase();
    const spec = { iid, field, kind, type };

    if (kind === 'weapon') {
      const atk = Math.max(0, (dmg > 0 ? dmg : 6) - 3);
      const speed = (-2.4 + (spd - 1) * 0.2).toFixed(2) + 'f';
      spec.itemExpr = () => era === 'old'
        ? `new SwordItem(Tiers.IRON, ${atk}, ${speed}, new Item.Properties()${dur > 0 ? `.durability(${dur})` : ''})`
        : `new SwordItem(Tiers.IRON, new Item.Properties().attributes(SwordItem.createAttributes(Tiers.IRON, ${atk}, ${speed})))`;
    } else if (kind === 'armor') {
      const slot = { helmet: 'HELMET', chestplate: 'CHESTPLATE', leggings: 'LEGGINGS', boots: 'BOOTS' }[type] || 'BOOTS';
      spec.itemExpr = () => `new ArmorItem(ArmorMaterials.IRON, ArmorItem.Type.${slot}, new Item.Properties())`;
    } else if (kind === 'food') {
      const satM = era === 'old' ? 'saturationMod' : 'saturationModifier';
      spec.itemExpr = () => `new Item(new Item.Properties().food(new FoodProperties.Builder().nutrition(${nutrition}).${satM}(${saturation}f).build()).stacksTo(${stack}))`;
    } else if (kind === 'block') {
      const ore = /block_ore/.test(type);
      spec.ore = ore;
      spec.blockExpr = `new Block(BlockBehaviour.Properties.of().strength(${hardness}f)${ore ? '.requiresCorrectToolForDrops()' : ''}${/block_light/.test(type) ? '.lightLevel(state -> 15)' : ''})`;
      spec.itemExpr = (blockRef) => `new BlockItem(${blockRef}, new Item.Properties().stacksTo(${stack}))`;
    } else {
      spec.itemExpr = () => `new Item(new Item.Properties().stacksTo(${stack})${item.glowing ? '.fireResistant()' : ''})`;
    }
    return spec;
  }

  function modelParent(type) {
    const t = String(type || '').toLowerCase();
    if (/block_/.test(t)) return 'minecraft:item/generated';
    if (/sword|axe|pickaxe|shovel|hoe|dagger|staff/.test(t)) return 'minecraft:item/handheld';
    return 'minecraft:item/generated';
  }

  // ───────────────────────── Рецепты ─────────────────────────

  const RL_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

  /** Возвращает JSON рецепта или null, если рецепта нет / он невалиден. */
  function recipeJsonForItem(item, modid, era, customIds) {
    const r = item.recipe;
    if (!r || !Array.isArray(r.pattern) || !r.key || typeof r.key !== 'object') return null;
    const pattern = r.pattern.map(row => String(row)).slice(0, 3);
    if (!pattern.length || pattern.some(row => row.length < 1 || row.length > 3)) return null;
    if (pattern.every(row => !row.trim())) return null;

    const key = {};
    const used = new Set(pattern.join('').replace(/ /g, '').split(''));
    for (const sym of used) {
      if (sym.length !== 1 || !r.key[sym]) return null;
      let ing = r.key[sym];
      let id = typeof ing === 'string' ? ing : (ing.item || ing.id);
      if (typeof id !== 'string') return null;
      // UI пишет «minecraft:<id>» и для своих предметов — переносим в пространство мода.
      const m = id.match(/^minecraft:(.+)$/);
      if (m && customIds.has(sanitizeId(m[1]))) id = `${modid}:${customIds.get(sanitizeId(m[1]))}`;
      if (!RL_RE.test(id)) return null;
      key[sym] = { item: id };
    }

    const count = Math.round(num(r.result && r.result.count, 1, 1, 64));
    // Результат всегда наш предмет: UI раньше писал туда чужой namespace «mdt:».
    const resultId = `${modid}:${item._iid}`;
    return {
      type: 'minecraft:crafting_shaped',
      pattern,
      key,
      result: era === 'old' ? { item: resultId, count } : { id: resultId, count }
    };
  }

  // ───────────────────────── Генерация проекта ─────────────────────────

  async function buildModProject(mod, JSZip) {
    if (!JSZip) throw new Error('JSZip is required');
    const zip = new JSZip();

    mod = Object.assign({}, mod, {
      name: cleanText(mod.name, 64, 'Mod'),
      author: cleanText(mod.author, 64, ''),
      desc: cleanText(mod.desc, 400, ''),
      modVer: cleanVersion(mod.modVer)
    });

    const modid = safeModId(mod.name);
    const target = resolveTarget(mod.platform, mod.version || '1.20.1');
    const prof = target.prof;
    const era = prof.era;
    const mcver = target.key;                       // версия, под которую реально собирается проект
    const requestedVer = cleanText(mod.version, 16, '1.20.1');
    const isNeo = target.family === 'neoforge';
    const isForge = target.family === 'forge';
    const isFabric = target.family === 'fabric';
    const javaVer = prof.java;
    const items = assignItemIds((mod.items || []).filter(Boolean));
    const specs = items.map(it => itemSpec(it, era));
    const customIds = new Map(items.map(it => [it._base, it._iid]));
    const pkg = `com.moddevtool.${modid}`;
    const mainClass = cap(modid.replace(/_/g, '')) + 'Mod';
    const author = mod.author || 'Anonymous';
    const modVer = mod.modVer;
    const srcRoot = `src/main/java/${pkg.replace(/\./g, '/')}`;
    const res = 'src/main/resources';
    const noteLines = [];
    if (target.adjusted) {
      noteLines.push(`Запрошен Minecraft ${requestedVer} (${mod.platform || 'Forge'}), но MDT умеет собирать для: ` +
        `${Object.keys(PROFILES[target.family]).join(', ')}. Проект собран под ${mcver}.`);
    }
    if (target.quilt) noteLines.push('Quilt: проект собирается как Fabric-мод — Quilt загружает такие моды без изменений.');
    const firstBlock = specs.filter(s => s.kind === 'block');

    const icon = specs.length ? specs[0] : null;

    // ───── Java: Forge / NeoForge ─────
    if (isForge || isNeo) {
      const regPkg = isNeo ? 'net.neoforged.neoforge.registries' : 'net.minecraftforge.registries';
      const holder = t => isNeo ? `DeferredHolder<${t}, ${t}>` : `RegistryObject<${t}>`;
      const regImports = isNeo
        ? `import net.minecraft.core.registries.BuiltInRegistries;\nimport net.minecraft.core.registries.Registries;\nimport ${regPkg}.DeferredHolder;\nimport ${regPkg}.DeferredRegister;`
        : `import net.minecraft.core.registries.Registries;\nimport ${regPkg}.DeferredRegister;\nimport ${regPkg}.ForgeRegistries;\nimport ${regPkg}.RegistryObject;`;
      const createReg = (forgeReg, vanillaReg, type) => isNeo
        ? `DeferredRegister.create(BuiltInRegistries.${vanillaReg}, ${mainClass}.MOD_ID)`
        : `DeferredRegister.create(ForgeRegistries.${forgeReg}, ${mainClass}.MOD_ID)`;

      const itemRegs = specs.map(s =>
        `    public static final ${holder('Item')} ${s.field} = ITEMS.register("${s.iid}", () -> ${s.itemExpr(`ModBlocks.${s.field}_BLOCK.get()`)});`
      ).join('\n');
      const blockRegs = specs.filter(s => s.kind === 'block').map(s =>
        `    public static final ${holder('Block')} ${s.field}_BLOCK = BLOCKS.register("${s.iid}", () -> ${s.blockExpr});`
      ).join('\n');

      const modsToml = isNeo
        ? [
            'modLoader="javafml"',
            'loaderVersion="[1,)"',
            'license="All Rights Reserved"',
            '',
            '[[mods]]',
            `modId="${modid}"`,
            `version="${modVer}"`,
            `displayName="${mod.name}"`,
            `authors="${author}"`,
            `description='''${mod.desc}'''`,
            '',
            `[[dependencies.${modid}]]`,
            'modId="neoforge"',
            'type="required"',
            'versionRange="[21.1,)"',
            'ordering="NONE"',
            'side="BOTH"',
            '',
            `[[dependencies.${modid}]]`,
            'modId="minecraft"',
            'type="required"',
            `versionRange="[${mcver},1.22)"`,
            'ordering="NONE"',
            'side="BOTH"',
            ''
          ].join('\n')
        : [
            'modLoader="javafml"',
            `loaderVersion="[${prof.loader},)"`,
            'license="All Rights Reserved"',
            '',
            '[[mods]]',
            `modId="${modid}"`,
            `version="${modVer}"`,
            `displayName="${mod.name}"`,
            `authors="${author}"`,
            `description='''${mod.desc}'''`,
            '',
            `[[dependencies.${modid}]]`,
            'modId="forge"',
            'mandatory=true',
            `versionRange="[${prof.loader},)"`,
            'ordering="NONE"',
            'side="BOTH"',
            '',
            `[[dependencies.${modid}]]`,
            'modId="minecraft"',
            'mandatory=true',
            `versionRange="[${mcver},)"`,
            'ordering="NONE"',
            'side="BOTH"',
            ''
          ].join('\n');

      zip.file(`${res}/META-INF/${isNeo ? 'neoforge.mods.toml' : 'mods.toml'}`, modsToml);

      const mainImports = isNeo
        ? 'import com.mojang.logging.LogUtils;\nimport net.neoforged.bus.api.IEventBus;\nimport net.neoforged.fml.common.Mod;\nimport org.slf4j.Logger;'
        : 'import net.minecraftforge.fml.common.Mod;\nimport net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;\nimport org.apache.logging.log4j.LogManager;\nimport org.apache.logging.log4j.Logger;';
      const loggerInit = isNeo ? 'LogUtils.getLogger()' : 'LogManager.getLogger()';
      const ctor = isNeo
        ? `public ${mainClass}(IEventBus bus) {`
        : `public ${mainClass}() {\n        var bus = FMLJavaModLoadingContext.get().getModEventBus();`;

      zip.file(`${srcRoot}/${mainClass}.java`,
`package ${pkg};

${mainImports}

/**
 * ${mod.name}
 * Generated by ModDevTool v${APP_VERSION} — © 2026 Puziko & Beliash
 * Author: ${author} | MC ${mcver} | ${isNeo ? 'NeoForge' : 'Forge'}
 */
@Mod(${mainClass}.MOD_ID)
public class ${mainClass} {
    public static final String MOD_ID = "${modid}";
    public static final Logger LOGGER = ${loggerInit};

    ${ctor}
        ModBlocks.BLOCKS.register(bus);
        ModItems.ITEMS.register(bus);
        ModCreativeTabs.TABS.register(bus);
        LOGGER.info("{} v{} loaded via ModDevTool", MOD_ID, "${modVer}");
    }
}
`);

      zip.file(`${srcRoot}/ModItems.java`,
`package ${pkg};

import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.*;
${regImports}

public class ModItems {
    public static final DeferredRegister<Item> ITEMS =
        ${createReg('ITEMS', 'ITEM')};

${itemRegs || '    // no items'}
}
`);

      zip.file(`${srcRoot}/ModBlocks.java`,
`package ${pkg};

import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockBehaviour;
${regImports}

public class ModBlocks {
    public static final DeferredRegister<Block> BLOCKS =
        ${createReg('BLOCKS', 'BLOCK')};

${blockRegs || '    // no blocks'}
}
`);

      const tabIcon = icon ? `new ItemStack(ModItems.${icon.field}.get())` : 'new ItemStack(Items.NETHER_STAR)';
      zip.file(`${srcRoot}/ModCreativeTabs.java`,
`package ${pkg};

import net.minecraft.network.chat.Component;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
${regImports}

public class ModCreativeTabs {
    public static final DeferredRegister<CreativeModeTab> TABS =
        DeferredRegister.create(Registries.CREATIVE_MODE_TAB, ${mainClass}.MOD_ID);

    public static final ${holder('CreativeModeTab')} MAIN = TABS.register("main", () ->
        CreativeModeTab.builder()
            .title(Component.translatable("itemGroup.${modid}"))
            .icon(() -> ${tabIcon})
            .displayItems((params, output) ->
                ModItems.ITEMS.getEntries().forEach(e -> output.accept(e.get())))
            .build());
}
`);
    }

    // ───── Java: Fabric ─────
    if (isFabric) {
      zip.file(`${res}/fabric.mod.json`, JSON.stringify({
        schemaVersion: 1,
        id: modid,
        version: modVer,
        name: mod.name,
        description: mod.desc.slice(0, 200),
        authors: [author],
        license: 'All Rights Reserved',
        environment: '*',
        entrypoints: { main: [`${pkg}.${mainClass}`] },
        depends: {
          fabricloader: '>=0.14.0',
          fabric: '*',
          minecraft: era === 'new' ? '~1.21.1' : `~${mcver}`,
          java: `>=${javaVer}`
        }
      }, null, 2));

      const rl = p => era === 'new'
        ? `ResourceLocation.fromNamespaceAndPath(MOD_ID, ${p})`
        : `new ResourceLocation(MOD_ID, ${p})`;
      const regLines = specs.map(s => {
        const lines = [];
        let ref = '';
        if (s.kind === 'block') {
          ref = `block_${s.iid}`;
          lines.push(`        Block ${ref} = Registry.register(BuiltInRegistries.BLOCK, ${rl(`"${s.iid}"`)}, ${s.blockExpr});`);
        }
        lines.push(`        registered.add(Registry.register(BuiltInRegistries.ITEM, ${rl(`"${s.iid}"`)}, ${s.itemExpr(ref)}));`);
        return lines.join('\n');
      }).join('\n');

      zip.file(`${srcRoot}/${mainClass}.java`,
`package ${pkg};

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.itemgroup.v1.FabricItemGroup;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.*;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockBehaviour;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

/**
 * ${mod.name}
 * Generated by ModDevTool v${APP_VERSION} — © 2026 Puziko & Beliash
 * Author: ${author} | MC ${mcver} | Fabric
 */
public class ${mainClass} implements ModInitializer {
    public static final String MOD_ID = "${modid}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        List<Item> registered = new ArrayList<>();
${regLines || '        // no items'}

        Registry.register(BuiltInRegistries.CREATIVE_MODE_TAB, ${rl('"main"')},
            FabricItemGroup.builder()
                .title(Component.translatable("itemGroup.${modid}"))
                .icon(() -> ${icon ? 'new ItemStack(registered.get(0))' : 'new ItemStack(Items.NETHER_STAR)'})
                .displayItems((params, output) -> registered.forEach(output::accept))
                .build());

        LOGGER.info("{} initialized (ModDevTool)", MOD_ID);
    }
}
`);
    }

    // ───── Ресурсы: ассеты ─────
    const assets = `${res}/assets/${modid}`;
    const enLang = {}, ruLang = {};
    enLang[`itemGroup.${modid}`] = mod.name;
    ruLang[`itemGroup.${modid}`] = mod.name;

    const lootDir = era === 'old' ? 'loot_tables' : 'loot_table';
    const recipeDir = era === 'old' ? 'recipes' : 'recipe';
    const tagDir = era === 'old' ? 'blocks' : 'block';
    const dataRoot = `${res}/data/${modid}`;

    items.forEach((item, idx) => {
      const s = specs[idx];
      const iid = s.iid;
      const langKey = s.kind === 'block' ? `block.${modid}.${iid}` : `item.${modid}.${iid}`;
      const displayName = cleanText(item.name, 64, iid);
      enLang[langKey] = displayName;
      ruLang[langKey] = displayName;

      if (s.kind === 'block') {
        zip.file(`${assets}/blockstates/${iid}.json`, JSON.stringify({ variants: { '': { model: `${modid}:block/${iid}` } } }, null, 2));
        zip.file(`${assets}/models/block/${iid}.json`, JSON.stringify({ parent: 'minecraft:block/cube_all', textures: { all: `${modid}:block/${iid}` } }, null, 2));
        zip.file(`${assets}/models/item/${iid}.json`, JSON.stringify({ parent: `${modid}:block/${iid}` }, null, 2));
        zip.file(`${assets}/textures/block/${iid}.png`, textureBytes(iid, true));
        zip.file(`${dataRoot}/${lootDir}/blocks/${iid}.json`, JSON.stringify({
          type: 'minecraft:block',
          pools: [{
            rolls: 1,
            bonus_rolls: 0,
            entries: [{ type: 'minecraft:item', name: `${modid}:${iid}` }],
            conditions: [{ condition: 'minecraft:survives_explosion' }]
          }]
        }, null, 2));
      } else {
        zip.file(`${assets}/models/item/${iid}.json`, JSON.stringify({
          parent: modelParent(item.type),
          textures: { layer0: `${modid}:item/${iid}` }
        }, null, 2));
        zip.file(`${assets}/textures/item/${iid}.png`, textureBytes(iid, false));
      }

      const recipe = recipeJsonForItem(item, modid, era, customIds);
      if (recipe) zip.file(`${dataRoot}/${recipeDir}/${iid}.json`, JSON.stringify(recipe, null, 2));
    });

    zip.file(`${assets}/lang/en_us.json`, JSON.stringify(enLang, null, 2));
    zip.file(`${assets}/lang/ru_ru.json`, JSON.stringify(ruLang, null, 2));

    // Теги блоков: добываются киркой, руда требует каменный инструмент
    const blockSpecs = specs.filter(s => s.kind === 'block');
    if (blockSpecs.length) {
      const tag = ids => JSON.stringify({ replace: false, values: ids.map(i => `${modid}:${i}`) }, null, 2);
      zip.file(`${res}/data/minecraft/tags/${tagDir}/mineable/pickaxe.json`, tag(blockSpecs.map(s => s.iid)));
      const ores = blockSpecs.filter(s => s.ore).map(s => s.iid);
      if (ores.length) zip.file(`${res}/data/minecraft/tags/${tagDir}/needs_stone_tool.json`, tag(ores));
    }

    zip.file(`${res}/pack.mcmeta`, JSON.stringify({
      pack: { pack_format: prof.pack, description: `${mod.name} v${modVer} — ModDevTool` }
    }, null, 2));

    // ───── Gradle ─────
    const foojay = `plugins {\n    id 'org.gradle.toolchains.foojay-resolver-convention' version '${FOOJAY_VERSION}'\n}\n`;
    const pluginRepos = isForge
      ? `    repositories {\n        gradlePluginPortal()\n        maven { name = 'MinecraftForge'; url = 'https://maven.minecraftforge.net/' }\n    }`
      : isNeo
        ? `    repositories {\n        gradlePluginPortal()\n        maven { name = 'NeoForged'; url = 'https://maven.neoforged.net/releases' }\n    }`
        : `    repositories {\n        maven { name = 'Fabric'; url = 'https://maven.fabricmc.net/' }\n        mavenCentral()\n        gradlePluginPortal()\n    }`;
    zip.file('settings.gradle', `pluginManagement {\n${pluginRepos}\n}\n\n${foojay}\nrootProject.name = '${modid}'\n`);

    const props = [
      'org.gradle.jvmargs=-Xmx2G',
      'org.gradle.parallel=true',
      `mod_id=${modid}`,
      `mod_name=${propEscape(mod.name)}`,
      `mod_version=${modVer}`,
      `maven_group=${pkg}`,
      `archives_base_name=${modid}`,
      `minecraft_version=${mcver}`
    ];
    if (isForge) props.push(`forge_version=${prof.forge}`);
    if (isNeo) props.push(`neo_version=${prof.neo}`);
    if (isFabric) props.push(`fabric_version=${prof.api}`, `loader_version=${FABRIC_LOADER_VERSION}`);
    props.push('');
    zip.file('gradle.properties', props.join('\n'));

    zip.file('gradle/wrapper/gradle-wrapper.properties', [
      'distributionBase=GRADLE_USER_HOME',
      'distributionPath=wrapper/dists',
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.8-bin.zip',
      'networkTimeout=10000',
      'validateDistributionUrl=true',
      'zipStoreBase=GRADLE_USER_HOME',
      'zipStorePath=wrapper/dists',
      ''
    ].join('\n'));

    const W = global.MDT_GRADLE_WRAPPER;
    const hasWrapper = !!(W && W.jar && W.gradlew && W.gradlewBat);
    if (hasWrapper) {
      zip.file('gradle/wrapper/gradle-wrapper.jar', b64ToBytes(W.jar));
      zip.file('gradlew', b64ToBytes(W.gradlew), { unixPermissions: 0o755 });
      zip.file('gradlew.bat', b64ToBytes(W.gradlewBat));
    }

    if (isFabric) {
      zip.file('build.gradle', `plugins {
    id 'fabric-loom' version '${LOOM_VERSION}'
    id 'maven-publish'
}

version = project.mod_version
group = project.maven_group
base { archivesName = project.archives_base_name }

java {
    toolchain { languageVersion = JavaLanguageVersion.of(${javaVer}) }
    withSourcesJar()
}

dependencies {
    minecraft "com.mojang:minecraft:\${project.minecraft_version}"
    mappings loom.officialMojangMappings()
    modImplementation "net.fabricmc:fabric-loader:\${project.loader_version}"
    modImplementation "net.fabricmc.fabric-api:fabric-api:\${project.fabric_version}"
}

tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
    options.release = ${javaVer}
}
`);
    } else if (isNeo) {
      zip.file('build.gradle', `plugins {
    id 'java'
    id 'idea'
    id 'net.neoforged.moddev' version '${prof.mdg}'
}

version = project.mod_version
group = project.maven_group
base { archivesName = project.archives_base_name }

java.toolchain.languageVersion = JavaLanguageVersion.of(${javaVer})

neoForge {
    version = project.neo_version

    runs {
        client { client() }
        server { server() }
    }

    mods {
        "\${project.mod_id}" { sourceSet sourceSets.main }
    }
}

tasks.withType(JavaCompile).configureEach { options.encoding = 'UTF-8' }
`);
    } else {
      zip.file('build.gradle', `plugins {
    id 'eclipse'
    id 'idea'
    id 'maven-publish'
    id 'net.minecraftforge.gradle' version '[6.0.16,6.2)'
}

version = project.mod_version
group = project.maven_group
base { archivesName = project.archives_base_name }

java.toolchain.languageVersion = JavaLanguageVersion.of(${javaVer})

minecraft {
    mappings channel: 'official', version: project.minecraft_version
    runs {
        client {
            workingDirectory project.file('run')
            mods { "\${project.mod_id}" { source sourceSets.main } }
        }
        server {
            workingDirectory project.file('run')
            args '--nogui'
            mods { "\${project.mod_id}" { source sourceSets.main } }
        }
    }
}

dependencies {
    minecraft "net.minecraftforge:forge:\${project.minecraft_version}-\${project.forge_version}"
}

tasks.named('jar', Jar).configure {
    manifest.attributes([
        'Implementation-Title'  : project.mod_name,
        'Implementation-Version': project.mod_version
    ])
    finalizedBy 'reobfJar'
}

tasks.withType(JavaCompile).configureEach { options.encoding = 'UTF-8' }
`);
    }

    // ───── Документация ─────
    const itemList = items.map(i => `- **${cleanText(i.name, 64, i._iid)}** (\`${cleanText(i.type, 24, 'item')}\`)${i.dmg ? ` — урон ${Math.round(num(i.dmg, 0, 0, 1000))}` : ''}`).join('\n') || 'Нет';
    const loaderName = isNeo ? 'NeoForge' : isFabric ? (target.quilt ? 'Quilt (через Fabric)' : 'Fabric') : 'Forge';
    const caveats = [
      'Все текстуры — автоматические заглушки 16×16 (цвет зависит от названия): замените PNG в `src/main/resources/assets/' + modid + '/textures/`.',
      'Предметы типа bow/staff/dagger регистрируются как мечи (`SwordItem`); броня использует материал `IRON`.',
      era === 'new' ? 'Прочность (`dur`) для оружия на 1.21.x берётся из `Tiers.IRON` — измените в `ModItems`/главном классе.' : null
    ].filter(Boolean).map(l => `- ${l}`).join('\n');

    zip.file('README.md', `# ${mod.name}

**Версия мода:** ${modVer}  
**Автор:** ${author}  
**Minecraft:** ${mcver}  
**Загрузчик:** ${loaderName}  
**modid:** \`${modid}\`

${noteLines.length ? noteLines.map(l => `> ⚠️ ${l}`).join('\n') + '\n\n' : ''}## Описание

${mod.desc || '—'}

## Предметы

${itemList}

## Сборка рабочего .jar

Браузер **не компилирует** Java в \`.class\`. Этот архив — полный исходный проект (как официальный MDK).

1. Установи **JDK ${javaVer}+** (если нужной версии нет, Gradle попробует скачать её сам)
2. Распакуй архив
3. В папке проекта:
${hasWrapper
  ? '   - Windows: `gradlew.bat build`\n   - Linux/macOS: `./gradlew build`'
  : '   - Установи Gradle 8.8+ и выполни `gradle build` (в архив не включён gradle-wrapper)'}
4. Готовый мод: \`build/libs/${modid}-${modVer}.jar\`${isFabric ? ' (не `-sources.jar`)' : ''}
5. Положи его в \`.minecraft/mods\`${isFabric ? '\n6. Для Fabric нужен также Fabric API' : ''}

> Первый запуск Gradle скачивает Minecraft и зависимости — нужен интернет и несколько минут.
> Версии зависимостей лежат в \`gradle.properties\` (и \`build.gradle\`) — при необходимости обновите их.

## Известные ограничения

${caveats}

---
Собрано **ModDevTool v${APP_VERSION}** · © 2026 Puziko & Beliash · All rights reserved.
`);

    zip.file('.gitignore', ['.gradle/', 'build/', 'run/', '.idea/', '*.iml', 'out/', 'eclipse/', '.settings/', '.classpath', '.project', ''].join('\n'));
    zip.file('LICENSE.txt', `All rights reserved © 2026 ${mod.author || 'Puziko & Beliash'}.\nGenerated with ModDevTool. Redistribution of ModDevTool itself is prohibited.\n`);

    const blob = await zip.generateAsync({
      type: 'blob',
      platform: 'UNIX',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: 'application/java-archive'
    });
    blob.mdtNote = noteLines.join(' ');
    blob.mdtTarget = { platform: loaderName, version: mcver, java: javaVer };
    return blob;
  }

  global.MDTJarBuilder = {
    buildModProject,
    sanitizeModId: safeModId,
    sanitizeId,
    mcverToPackFormat,
    resolveTarget,
    cap,
    cleanText,
    assignItemIds,
    javaVersionFor,
    supported: PROFILES,
    version: '7.3.0-builder'
  };
})(typeof window !== 'undefined' ? window : globalThis);
