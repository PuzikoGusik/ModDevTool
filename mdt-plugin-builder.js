/**
 * ModDevTool — Plugin builder (Bukkit / Spigot / Paper)
 * © 2026 Puziko & Beliash. All rights reserved.
 *
 * Строит Gradle-проект серверного плагина: plugin.yml, config.yml, Java-код
 * команд и событий, build.gradle, Gradle wrapper (если подключён
 * mdt-gradle-wrapper.js), README. Браузер не компилирует Java — готовый .jar
 * получается командой ./gradlew build.
 *
 * MDTPlugin.plan(spec)           -> { files, warnings, info }
 * MDTPlugin.build(spec, JSZip)   -> Promise<{ blob, filename, files, warnings, info }>
 *
 * spec = {
 *   name, version, author, description,
 *   platform: 'paper' | 'spigot',
 *   mcVersion: '1.20.4' | '1.21.1' | '1.21.4',
 *   commands: [{ name, description, permission: bool, permDefault: 'op'|'true', aliases: 'a, b',
 *                action: { type, text, item, amount, cmd, mode } }],
 *   events:   [{ type: 'join'|'quit'|'death'|'blockbreak'|'title'|'kit', text, subtitle, items:[{item,amount}] }]
 * }
 */
(function (global) {
  'use strict';

  const TARGETS = {
    '1.20.4': { java: 17, api: '1.20.4-R0.1-SNAPSHOT', apiVersion: '1.20' },
    '1.21.1': { java: 21, api: '1.21.1-R0.1-SNAPSHOT', apiVersion: '1.21' },
    '1.21.4': { java: 21, api: '1.21.4-R0.1-SNAPSHOT', apiVersion: '1.21' }
  };
  const RUN_PAPER_VERSION = '2.3.1';
  const FOOJAY_VERSION = '0.8.0';
  const GRADLE_VERSION = '8.8';

  const ACTIONS = {
    message:   { label: 'Отправить сообщение',     player: false, dangerous: false },
    broadcast: { label: 'Сообщение всем',          player: false, dangerous: false },
    heal:      { label: 'Вылечить игрока',         player: true,  dangerous: false },
    feed:      { label: 'Накормить игрока',        player: true,  dangerous: false },
    fly:       { label: 'Переключить полёт',       player: true,  dangerous: false },
    spawn:     { label: 'Телепорт на спавн',       player: true,  dangerous: false },
    give:      { label: 'Выдать предмет',          player: true,  dangerous: true  },
    gamemode:  { label: 'Сменить режим игры',      player: true,  dangerous: true  },
    console:   { label: 'Команда от консоли',      player: false, dangerous: true  }
  };
  const GAMEMODES = ['SURVIVAL', 'CREATIVE', 'ADVENTURE', 'SPECTATOR'];
  const EVENT_TYPES = ['join', 'quit', 'death', 'blockbreak', 'title', 'kit'];

  const JAVA_RESERVED = new Set(('abstract assert boolean break byte case catch char class const continue default do ' +
    'double else enum extends final finally float for goto if implements import instanceof int interface long native ' +
    'new package private protected public return short static strictfp super switch synchronized this throw throws ' +
    'transient try void volatile while true false null var record yield sealed permits').split(' '));

  const TRANSLIT = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'j','к':'k','л':'l','м':'m',
    'н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'shch',
    'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya','і':'i','ї':'yi','є':'ye','ґ':'g'
  };
  const translit = s => String(s == null ? '' : s).toLowerCase().replace(/[а-яёіїєґ]/g, c => TRANSLIT[c] || '');

  /** Строка для обычных текстов: без управляющих символов, одна строка. */
  function oneLine(raw, max, fallback) {
    const t = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    return t || fallback || '';
  }

  /** Java string literal (с кавычками). Бэкслеш экранируется, поэтому \u-последовательности не возникают. */
  function jstr(s) {
    return '"' + String(s == null ? '' : s).replace(/[\\"\u0000-\u001f\u007f\u2028\u2029]/g, c => {
      if (c === '\\') return '\\\\';
      if (c === '"') return '\\"';
      if (c === '\n') return '\\n';
      if (c === '\r') return '\\r';
      if (c === '\t') return '\\t';
      return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
    }) + '"';
  }

  /** YAML-скаляр в двойных кавычках (JSON-строка — валидный YAML). */
  const ystr = s => JSON.stringify(String(s == null ? '' : s));

  function clampInt(v, def, min, max) {
    let n = Math.floor(Number(v));
    if (!isFinite(n)) n = def;
    return Math.min(max, Math.max(min, n));
  }

  function pascal(raw, fallback) {
    const parts = translit(raw).split(/[^a-z0-9]+/).filter(Boolean);
    let s = parts.map(p => p[0].toUpperCase() + p.slice(1)).join('');
    if (!s) s = fallback || 'Plugin';
    if (/^[0-9]/.test(s)) s = 'P' + s;
    return s.slice(0, 40);
  }

  function pkgSegment(raw) {
    let s = translit(raw).replace(/[^a-z0-9]+/g, '').slice(0, 30);
    if (!s) s = 'plugin';
    if (!/^[a-z]/.test(s)) s = 'p' + s;
    if (JAVA_RESERVED.has(s)) s += 'plugin';
    return s;
  }

  function cmdName(raw) {
    return translit(raw).replace(/^\/+/, '').replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  }

  function cleanVersion(raw) {
    return String(raw || '').replace(/[^0-9A-Za-z.+_-]/g, '').slice(0, 32) || '1.0.0';
  }

  // ───────────── Генерация ─────────────
  function plan(specIn) {
    const spec = specIn || {};
    const warnings = [];
    const warn = m => warnings.push(m);

    // Цель
    let mc = String(spec.mcVersion || '1.21.1');
    if (!TARGETS[mc]) {
      const fallback = '1.21.1';
      warn(`Версия Minecraft ${mc} не поддерживается — использована ${fallback}.`);
      mc = fallback;
    }
    const T = TARGETS[mc];
    const platform = spec.platform === 'spigot' ? 'spigot' : 'paper';

    const displayName = oneLine(spec.name, 40, 'MyPlugin');
    const className = pascal(displayName, 'MyPlugin');
    const pluginName = className; // plugin.yml name: [A-Za-z0-9_.-]
    const slug = pkgSegment(displayName);
    const pkg = `com.moddevtool.${slug}`;
    const mainClass = className.endsWith('Plugin') ? className : className + 'Plugin';
    const version = cleanVersion(spec.version);
    const author = oneLine(spec.author, 40, 'Anonymous');
    const description = oneLine(spec.description, 200, '');
    const srcRoot = `src/main/java/${pkg.replace(/\./g, '/')}`;
    const files = {};
    const put = (path, content) => { files[path] = content; };

    // Команды
    const seen = new Set();
    const commands = [];
    (spec.commands || []).forEach((c, i) => {
      const name = cmdName(c && c.name);
      if (!name) { warn(`Команда #${i + 1}: некорректное имя — пропущена.`); return; }
      if (seen.has(name)) { warn(`Команда /${name} повторяется — вторая пропущена.`); return; }
      seen.add(name);
      const a = (c && c.action) || {};
      const type = ACTIONS[a.type] ? a.type : 'message';
      let permission = c.permission !== false;
      let permDefault = c.permDefault === 'true' ? 'true' : 'op';
      if (ACTIONS[type].dangerous) {
        if (!permission || permDefault === 'true') warn(`Команда /${name} («${ACTIONS[type].label}») может дать игрокам лишние возможности — доступ ограничен операторами.`);
        permission = true; permDefault = 'op';
      }
      const action = { type };
      action.text = oneLine(a.text, 300, '');
      if (type === 'give') {
        action.item = oneLine(a.item, 60, 'DIAMOND').toUpperCase().replace(/^MINECRAFT:/, '').replace(/[^A-Z0-9_]/g, '') || 'DIAMOND';
        action.amount = clampInt(a.amount, 1, 1, 64);
      }
      if (type === 'gamemode') action.mode = GAMEMODES.includes(String(a.mode).toUpperCase()) ? String(a.mode).toUpperCase() : 'CREATIVE';
      if (type === 'console') {
        action.cmd = oneLine(a.cmd, 200, '').replace(/^\/+/, '');
        if (!action.cmd) { warn(`Команда /${name}: пустая консольная команда — пропущена.`); return; }
        if (/%args%/i.test(action.cmd)) {
          warn(`Команда /${name}: %args% в консольной команде удалён — иначе игрок мог бы выполнить любую консольную команду.`);
          action.cmd = action.cmd.replace(/%args%/gi, '').replace(/\s+/g, ' ').trim();
        }
      }
      const defaults = {
        message: 'Привет, %player%!', broadcast: '&e%player% объявляет: привет всем!',
        heal: '&aВы исцелены!', feed: '&aВы сыты!', spawn: '&aТелепортация на спавн.',
        give: '&aВы получили предмет.', gamemode: '&aРежим игры изменён.', console: '&aГотово.'
      };
      if (!action.text && defaults[type]) action.text = defaults[type];
      const aliases = String(c.aliases || '').split(/[,\s]+/).map(cmdName).filter(x => x && x !== name).slice(0, 5);
      commands.push({
        name, type, action, permission, permDefault, aliases,
        description: oneLine(c.description, 120, `Команда /${name}`),
        playerOnly: ACTIONS[type].player
      });
    });

    // События
    const events = [];
    const seenEv = new Set();
    (spec.events || []).forEach(e => {
      if (!e || !EVENT_TYPES.includes(e.type)) return;
      if (seenEv.has(e.type)) { warn(`Событие «${e.type}» указано дважды — второе пропущено.`); return; }
      seenEv.add(e.type);
      const ev = { type: e.type, text: oneLine(e.text, 300, ''), subtitle: oneLine(e.subtitle, 200, '') };
      if (e.type === 'kit') {
        ev.items = (e.items || []).map(it => ({
          item: oneLine(it && it.item, 60, '').toUpperCase().replace(/^MINECRAFT:/, '').replace(/[^A-Z0-9_]/g, ''),
          amount: clampInt(it && it.amount, 1, 1, 64)
        })).filter(it => it.item).slice(0, 20);
        if (!ev.items.length) { warn('Стартовый набор пуст — событие пропущено.'); return; }
      }
      const defaults = {
        join: '&e+ &f%player% &7зашёл на сервер', quit: '&e- &f%player% &7вышел с сервера',
        death: '&c☠ &f%player% &7погиб', blockbreak: '&7Вы сломали &f%block%', title: '&6Добро пожаловать!'
      };
      if (!ev.text && defaults[e.type] !== undefined && e.type !== 'kit') ev.text = defaults[e.type];
      if (e.type === 'title' && !ev.subtitle) ev.subtitle = '&7Приятной игры, %player%';
      events.push(ev);
    });

    if (!commands.length && !events.length) warn('Плагин пуст: добавь хотя бы одну команду или событие.');

    // ── plugin.yml ──
    const yml = [
      `name: ${pluginName}`,
      `version: ${ystr(version)}`,
      `main: ${pkg}.${mainClass}`,
      `api-version: ${ystr(T.apiVersion)}`,
      `author: ${ystr(author)}`
    ];
    if (description) yml.push(`description: ${ystr(description)}`);
    if (commands.length) {
      yml.push('commands:');
      commands.forEach(c => {
        yml.push(`  ${ystr(c.name)}:`);
        yml.push(`    description: ${ystr(c.description)}`);
        yml.push(`    usage: ${ystr('/<command>')}`);
        if (c.aliases.length) yml.push(`    aliases: [${c.aliases.map(ystr).join(', ')}]`);
        if (c.permission) {
          yml.push(`    permission: ${ystr(slug + '.' + c.name)}`);
          yml.push(`    permission-message: ${ystr('У вас нет прав для этой команды.')}`);
        }
      });
      const perms = commands.filter(c => c.permission);
      if (perms.length) {
        yml.push('permissions:');
        perms.forEach(c => {
          yml.push(`  ${ystr(slug + '.' + c.name)}:`);
          yml.push(`    description: ${ystr('Доступ к /' + c.name)}`);
          yml.push(`    default: ${c.permDefault}`);
        });
      }
    }
    put('src/main/resources/plugin.yml', yml.join('\n') + '\n');

    // ── config.yml (тексты можно править без перекомпиляции) ──
    const cfg = ['# Тексты плагина. Цветовые коды: &a &c &e &6 … Плейсхолдеры: %player% %online% %args% (только в сообщениях команд)', 'messages:'];
    cfg.push('  commands:');
    if (!commands.length) cfg[cfg.length - 1] = '  commands: {}';
    commands.forEach(c => {
      if (c.type === 'fly') {
        cfg.push(`    ${ystr(c.name)}:`);
        cfg.push(`      ${ystr('on')}: ${ystr(c.action.text || '&aПолёт включён.')}`);
        cfg.push(`      ${ystr('off')}: ${ystr('&cПолёт выключен.')}`);
      } else if (c.type !== 'console') {
        cfg.push(`    ${ystr(c.name)}: ${ystr(c.action.text)}`);
      }
    });
    cfg.push('  events:');
    if (!events.some(e => e.type !== 'kit')) cfg[cfg.length - 1] = '  events: {}';
    events.filter(e => e.type !== 'kit').forEach(e => {
      if (e.type === 'title') {
        cfg.push(`    ${ystr('title')}: ${ystr(e.text)}`);
        cfg.push(`    ${ystr('subtitle')}: ${ystr(e.subtitle)}`);
      } else {
        cfg.push(`    ${ystr(e.type)}: ${ystr(e.text)}`);
      }
    });
    put('src/main/resources/config.yml', cfg.join('\n') + '\n');

    // ── Main ──
    const reg = commands.map(c => `        registerCommand(${jstr(c.name)}, executor);`).join('\n');
    put(`${srcRoot}/${mainClass}.java`,
`package ${pkg};

import org.bukkit.ChatColor;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.java.JavaPlugin;

/** ${oneLine(displayName, 40, pluginName).replace(/\*\//g, '')} — сгенерировано ModDevTool. */
public final class ${mainClass} extends JavaPlugin {

    @Override
    public void onEnable() {
        saveDefaultConfig();
${commands.length ? `        CommandExecutor executor = new ${className}Commands(this);\n${reg}\n` : ''}${events.length ? `        getServer().getPluginManager().registerEvents(new ${className}Listener(this), this);\n` : ''}        getLogger().info(${jstr(pluginName + ' v' + version + ' включён')});
    }

    @Override
    public void onDisable() {
        getLogger().info(${jstr(pluginName + ' выключен')});
    }

    private void registerCommand(String name, CommandExecutor executor) {
        PluginCommand command = getCommand(name);
        if (command == null) {
            getLogger().warning("Команда не найдена в plugin.yml: " + name);
            return;
        }
        command.setExecutor(executor);
    }

    /** Текст из config.yml (раздел messages), либо значение по умолчанию. */
    public String msg(String path, String def) {
        return getConfig().getString("messages." + path, def);
    }

    /** &-коды -> цвета. */
    public String color(String text) {
        return ChatColor.translateAlternateColorCodes('&', text == null ? "" : text);
    }
}
`);

    // ── Commands ──
    if (commands.length) {
      const cases = commands.map(c => {
        const a = c.action;
        const lines = [];
        const guard = c.playerOnly
          ? `                if (!(sender instanceof Player)) {\n                    sender.sendMessage(plugin.color("&cЭту команду может использовать только игрок."));\n                    return true;\n                }\n                Player player = (Player) sender;\n`
          : '';
        const msgKey = jstr('commands.' + c.name);
        const say = `plugin.color(fmt(plugin.msg(${msgKey}, ${jstr(a.text)}), sender, args))`;
        switch (c.type) {
          case 'message':
            lines.push(`                sender.sendMessage(${say});`); break;
          case 'broadcast':
            lines.push(`                Bukkit.broadcastMessage(${say});`); break;
          case 'heal':
            lines.push(`                player.setHealth(player.getMaxHealth());`, `                player.sendMessage(${say});`); break;
          case 'feed':
            lines.push(`                player.setFoodLevel(20);`, `                player.setSaturation(20f);`, `                player.sendMessage(${say});`); break;
          case 'fly':
            lines.push(
              `                boolean enable = !player.getAllowFlight();`,
              `                player.setAllowFlight(enable);`,
              `                if (!enable) {`,
              `                    player.setFlying(false);`,
              `                }`,
              `                player.sendMessage(plugin.color(fmt(plugin.msg(${jstr('commands.' + c.name + (true ? '.' : ''))} + (enable ? "on" : "off"), enable ? ${jstr(a.text || '&aПолёт включён.')} : "&cПолёт выключен."), sender, args)));`);
            break;
          case 'spawn':
            lines.push(`                player.teleport(player.getWorld().getSpawnLocation());`, `                player.sendMessage(${say});`); break;
          case 'give':
            lines.push(
              `                Material material = Material.matchMaterial(${jstr(a.item)});`,
              `                if (material == null) {`,
              `                    player.sendMessage(plugin.color("&cНеизвестный предмет: " + ${jstr(a.item)}));`,
              `                    return true;`,
              `                }`,
              `                Map<Integer, ItemStack> leftover = player.getInventory().addItem(new ItemStack(material, ${a.amount}));`,
              `                for (ItemStack rest : leftover.values()) {`,
              `                    player.getWorld().dropItemNaturally(player.getLocation(), rest);`,
              `                }`,
              `                player.sendMessage(${say});`);
            break;
          case 'gamemode':
            lines.push(`                player.setGameMode(GameMode.${a.mode});`, `                player.sendMessage(${say});`); break;
          case 'console':
            lines.push(
              `                String line = ${jstr(a.cmd)}.replace("%player%", sender.getName()).replace("%online%", String.valueOf(Bukkit.getOnlinePlayers().size()));`,
              `                Bukkit.dispatchCommand(Bukkit.getConsoleSender(), line);`,
              `                sender.sendMessage(plugin.color(${jstr(a.text)}));`);
            break;
        }
        return `            case ${jstr(c.name)}: {\n${guard}${lines.join('\n')}\n                return true;\n            }`;
      }).join('\n');

      put(`${srcRoot}/${className}Commands.java`,
`package ${pkg};

import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.Locale;
import java.util.Map;

public final class ${className}Commands implements CommandExecutor {

    private final ${mainClass} plugin;

    public ${className}Commands(${mainClass} plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        switch (command.getName().toLowerCase(Locale.ROOT)) {
${cases}
            default:
                return false;
        }
    }

    /** Подстановка %player%, %online%, %args%. */
    private String fmt(String text, CommandSender sender, String[] args) {
        return text
            .replace("%player%", sender.getName())
            .replace("%online%", String.valueOf(Bukkit.getOnlinePlayers().size()))
            .replace("%args%", String.join(" ", args));
    }
}
`);
    }

    // ── Listener ──
    if (events.length) {
      const imports = new Set(['import org.bukkit.Bukkit;', 'import org.bukkit.event.EventHandler;', 'import org.bukkit.event.Listener;']);
      const methods = events.map(e => {
        const key = jstr('events.' + e.type);
        switch (e.type) {
          case 'join':
            imports.add('import org.bukkit.event.player.PlayerJoinEvent;');
            return `    @EventHandler\n    public void onJoin(PlayerJoinEvent event) {\n        String text = fmt(plugin.msg(${key}, ${jstr(e.text)}), event.getPlayer().getName(), "");\n        event.setJoinMessage(text.isEmpty() ? null : plugin.color(text));\n    }`;
          case 'quit':
            imports.add('import org.bukkit.event.player.PlayerQuitEvent;');
            return `    @EventHandler\n    public void onQuit(PlayerQuitEvent event) {\n        String text = fmt(plugin.msg(${key}, ${jstr(e.text)}), event.getPlayer().getName(), "");\n        event.setQuitMessage(text.isEmpty() ? null : plugin.color(text));\n    }`;
          case 'death':
            imports.add('import org.bukkit.event.entity.PlayerDeathEvent;');
            return `    @EventHandler\n    public void onDeath(PlayerDeathEvent event) {\n        String text = fmt(plugin.msg(${key}, ${jstr(e.text)}), event.getEntity().getName(), "");\n        event.setDeathMessage(text.isEmpty() ? null : plugin.color(text));\n    }`;
          case 'blockbreak':
            imports.add('import org.bukkit.event.block.BlockBreakEvent;');
            return `    @EventHandler\n    public void onBlockBreak(BlockBreakEvent event) {\n        String text = fmt(plugin.msg(${key}, ${jstr(e.text)}), event.getPlayer().getName(), event.getBlock().getType().name());\n        if (!text.isEmpty()) {\n            event.getPlayer().sendMessage(plugin.color(text));\n        }\n    }`;
          case 'title':
            imports.add('import org.bukkit.event.player.PlayerJoinEvent;');
            imports.add('import org.bukkit.entity.Player;');
            return `    @EventHandler\n    public void onJoinTitle(PlayerJoinEvent event) {\n        Player player = event.getPlayer();\n        String title = fmt(plugin.msg("events.title", ${jstr(e.text)}), player.getName(), "");\n        String subtitle = fmt(plugin.msg("events.subtitle", ${jstr(e.subtitle)}), player.getName(), "");\n        player.sendTitle(plugin.color(title), plugin.color(subtitle), 10, 70, 20);\n    }`;
          case 'kit': {
            imports.add('import org.bukkit.event.player.PlayerJoinEvent;');
            imports.add('import org.bukkit.entity.Player;');
            imports.add('import org.bukkit.Material;');
            imports.add('import org.bukkit.inventory.ItemStack;');
            imports.add('import java.util.Map;');
            const rows = e.items.map(it => `            give(player, ${jstr(it.item)}, ${it.amount});`).join('\n');
            return `    @EventHandler\n    public void onFirstJoinKit(PlayerJoinEvent event) {\n        Player player = event.getPlayer();\n        if (player.hasPlayedBefore()) {\n            return;\n        }\n${rows}\n    }\n\n    private void give(Player player, String materialName, int amount) {\n        Material material = Material.matchMaterial(materialName);\n        if (material == null) {\n            plugin.getLogger().warning("Неизвестный материал в стартовом наборе: " + materialName);\n            return;\n        }\n        Map<Integer, ItemStack> leftover = player.getInventory().addItem(new ItemStack(material, amount));\n        for (ItemStack rest : leftover.values()) {\n            player.getWorld().dropItemNaturally(player.getLocation(), rest);\n        }\n    }`;
          }
        }
        return '';
      }).join('\n\n');

      put(`${srcRoot}/${className}Listener.java`,
`package ${pkg};

${[...imports].sort().join('\n')}

public final class ${className}Listener implements Listener {

    private final ${mainClass} plugin;

    public ${className}Listener(${mainClass} plugin) {
        this.plugin = plugin;
    }

${methods}

    /** Подстановка %player%, %online%, %block%. */
    private String fmt(String text, String playerName, String blockName) {
        return text
            .replace("%player%", playerName)
            .replace("%online%", String.valueOf(Bukkit.getOnlinePlayers().size()))
            .replace("%block%", blockName);
    }
}
`);
    }

    // ── Gradle ──
    const paper = platform === 'paper';
    put('settings.gradle', `plugins {\n    id 'org.gradle.toolchains.foojay-resolver-convention' version '${FOOJAY_VERSION}'\n}\n\nrootProject.name = ${jstr(pluginName).replace(/"/g, "'")}\n`);
    put('gradle.properties', `org.gradle.jvmargs=-Xmx1G\nplugin_version=${version}\n`);
    put('build.gradle',
`plugins {
    id 'java'${paper ? `\n    id 'xyz.jpenilla.run-paper' version '${RUN_PAPER_VERSION}'` : ''}
}

group = '${pkg}'
version = plugin_version

repositories {
    mavenCentral()
${paper
  ? "    maven { name = 'papermc'; url = 'https://repo.papermc.io/repository/maven-public/' }"
  : "    maven { name = 'spigotmc'; url = 'https://hub.spigotmc.org/nexus/content/repositories/snapshots/' }"}
}

dependencies {
    compileOnly '${paper ? 'io.papermc.paper:paper-api' : 'org.spigotmc:spigot-api'}:${T.api}'
}

java {
    toolchain.languageVersion = JavaLanguageVersion.of(${T.java})
}

tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
    options.release = ${T.java}
}
${paper ? `
tasks {
    runServer {
        minecraftVersion('${mc}')   // ./gradlew runServer — тестовый сервер Paper с плагином
    }
}
` : ''}`);
    put('.gitignore', ['.gradle/', 'build/', 'run/', '.idea/', '*.iml', 'out/', ''].join('\n'));

    // README
    const cmdList = commands.map(c => `- \`/${c.name}\` — ${c.description}${c.permission ? ` (право \`${slug}.${c.name}\`, по умолчанию: ${c.permDefault === 'op' ? 'только операторы' : 'все'})` : ''}`).join('\n') || '—';
    const evList = events.map(e => `- ${e.type}`).join('\n') || '—';
    const warnMd = warnings.length ? '## ⚠ Внимание\n\n' + warnings.map(w => `- ${w}`).join('\n') + '\n\n' : '';
    put('README.md',
`# ${displayName}

${warnMd}**Версия:** ${version} · **Автор:** ${author}  
**Платформа:** ${paper ? 'Paper' : 'Spigot'} ${mc} (Java ${T.java}+)

${description || ''}

## Команды

${cmdList}

## События

${evList}

## Сборка

1. Установи JDK ${T.java}+
2. В папке проекта: \`./gradlew build\` (Windows: \`gradlew.bat build\`)
3. Готовый плагин: \`build/libs/${pluginName}-${version}.jar\` → в папку \`plugins/\` сервера
${paper ? '4. Тестовый сервер: `./gradlew runServer`\n' : ''}
Все тексты лежат в \`plugins/${pluginName}/config.yml\` (создаётся при первом запуске) — их можно менять без пересборки; \`/reload\` не нужен, но плагин надо перезапустить.

> Код сгенерирован автоматически. Если сборка не прошла — пришли лог ошибки.

---
Собрано **ModDevTool** · © 2026 Puziko & Beliash
`);

    return {
      files, warnings,
      info: { pluginName, className, mainClass, pkg, slug, mcVersion: mc, platform, java: T.java, version, commands: commands.map(c => c.name), events: events.map(e => e.type) }
    };
  }

  async function build(spec, JSZip) {
    if (!JSZip) throw new Error('JSZip is required');
    const p = plan(spec);
    const zip = new JSZip();
    Object.keys(p.files).forEach(path => zip.file(path, p.files[path]));

    const W = global.MDT_GRADLE_WRAPPER;
    zip.file('gradle/wrapper/gradle-wrapper.properties', [
      'distributionBase=GRADLE_USER_HOME',
      'distributionPath=wrapper/dists',
      `distributionUrl=https\\://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`,
      'networkTimeout=10000',
      'validateDistributionUrl=true',
      'zipStoreBase=GRADLE_USER_HOME',
      'zipStorePath=wrapper/dists',
      ''
    ].join('\n'));
    if (W && W.jar && W.gradlew && W.gradlewBat) {
      zip.file('gradle/wrapper/gradle-wrapper.jar', W.jar, { base64: true });
      zip.file('gradlew', W.gradlew, { base64: true, unixPermissions: 0o755 });
      zip.file('gradlew.bat', W.gradlewBat, { base64: true });
    } else {
      p.warnings.push('mdt-gradle-wrapper.js не загружен — в архиве нет gradlew; используйте установленный Gradle 8.8+ (gradle build).');
    }
    const blob = await zip.generateAsync({
      type: 'blob', platform: 'UNIX', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip'
    });
    return { blob, filename: `${p.info.pluginName}-${p.info.version}-src.zip`, files: Object.keys(p.files), warnings: p.warnings, info: p.info };
  }

  global.MDTPlugin = { plan, build, ACTIONS, EVENT_TYPES, GAMEMODES, TARGETS, jstr, version: '0.1.0' };
})(typeof window !== 'undefined' ? window : globalThis);
