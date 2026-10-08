import { safeProjectPath, languageFor, requiredJava, resourcePath } from './mdt-code-utils.js';

const element = id => document.getElementById(id);
const files = new Map();
const dependencies = [];
const encoder = new TextEncoder();
let selectedPath;
let dirty = false;
let artifactUrl;
let compilerFrame;
let stopCompiler;
let compiling = false;
let isTemplate = true;

function output(message, state = 'Готов к работе') {
  element('compile-output').textContent = message;
  element('compile-status').textContent = state;
}

function invalidateArtifact() {
  if (artifactUrl) URL.revokeObjectURL(artifactUrl);
  artifactUrl = null;
  element('artifact-download').hidden = true;
}

function changed() {
  dirty = true;
  isTemplate = false;
  invalidateArtifact();
}

function selectFile(path) {
  selectedPath = path;
  const content = files.get(path);
  element('active-file').textContent = path;
  element('active-language').textContent = languageFor(path);
  element('source-editor').value = typeof content === 'string' ? content : 'Бинарный ресурс. Содержимое сохраняется в архиве без изменений.';
  element('source-editor').disabled = typeof content !== 'string';
  element('remove-file').disabled = compiling;
  renderFiles();
}

function renderFiles() {
  element('project-files').replaceChildren();
  for (const path of [...files.keys()].sort()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mdt-file-button${path === selectedPath ? ' active' : ''}`;
    button.textContent = path;
    button.title = path;
    button.addEventListener('click', () => selectFile(path));
    element('project-files').append(button);
  }
}

function template(kind) {
  isTemplate = true;
  files.clear();
  if (kind === 'web') {
    files.set('index.html', '<!doctype html>\n<html lang="ru">\n<head>\n  <meta charset="utf-8">\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Мой проект</h1>\n  <button id="hello">Нажми меня</button>\n  <script src="script.js"></script>\n</body>\n</html>\n');
    files.set('style.css', 'body {\n  background: #10231b;\n  color: #b4f7be;\n  font-family: monospace;\n  padding: 48px;\n}\nbutton { padding: 12px 20px; }\n');
    files.set('script.js', 'document.getElementById("hello").addEventListener("click", () => {\n  document.querySelector("h1").textContent = "Работает!";\n});\n');
  } else if (kind === 'datapack') {
    files.set('pack.mcmeta', JSON.stringify({ pack: { pack_format: 48, description: 'Мой датапак для Minecraft 1.21' } }, null, 2));
    files.set('data/example/function/hello.mcfunction', 'say Привет из ModDevTool!\n');
  } else if (kind === 'plugin') {
    files.set('src/main/java/example/ExamplePlugin.java', 'package example;\n\nimport org.bukkit.plugin.java.JavaPlugin;\n\npublic class ExamplePlugin extends JavaPlugin {\n  @Override\n  public void onEnable() {\n    getLogger().info("Плагин запущен!");\n  }\n}\n');
    files.set('src/main/resources/plugin.yml', 'name: ExamplePlugin\nversion: 1.0.0\nmain: example.ExamplePlugin\napi-version: "1.20"\n');
  } else {
    files.set('src/main/java/example/Example.java', 'package example;\n\npublic class Example {\n  public static String greeting() {\n    return "Привет из ModDevTool!";\n  }\n}\n');
    if (kind === 'mod') files.set('README.md', 'Это пример Java-класса, не устанавливаемый Minecraft-мод.\n\nОткройте ZIP, созданный конструктором модов, и добавьте API-зависимости для проверки кода.\nДля итогового игрового JAR используйте Gradle и remap/reobfuscation.\n');
  }
  dirty = false;
  invalidateArtifact();
  selectFile(files.keys().next().value);
  output(kind === 'plugin' ? 'Добавьте подходящий Bukkit / Spigot / Paper API JAR перед компиляцией.' : kind === 'mod' ? 'Мод: проверка Java-кода. Итоговый игровой JAR требует Gradle и обработки загрузчика.' : 'Готово. Редактируйте файлы и собирайте проект.');
}

async function importArchive(blob, kind) {
  if (blob.size > 32 * 1024 * 1024) throw new Error('Архив слишком большой: максимум 32 МБ.');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  if (entries.length > 400) throw new Error('Максимум 400 файлов в проекте.');
  const next = new Map();
  let total = 0;
  for (const entry of entries) {
    if (!safeProjectPath(entry.name) || (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name)) throw new Error('Архив содержит недопустимый путь.');
    if (entry._data?.uncompressedSize > 16 * 1024 * 1024) throw new Error('Ресурс слишком большой: максимум 16 МБ.');
    const content = await entry.async('uint8array');
    total += content.byteLength;
    if (total > 48 * 1024 * 1024) throw new Error('Распакованный проект превышает 48 МБ.');
    next.set(entry.name, languageFor(entry.name) === 'BINARY' ? content : new TextDecoder().decode(content));
  }
  if (!next.size) throw new Error('Архив пуст.');
  isTemplate = false;
  files.clear();
  for (const entry of next) files.set(...entry);
  if (kind) element('project-kind').value = kind;
  else if (files.has('pack.mcmeta')) element('project-kind').value = 'datapack';
  else if ([...files.keys()].some(path => path.endsWith('plugin.yml'))) element('project-kind').value = 'plugin';
  else if (files.has('index.html')) element('project-kind').value = 'web';
  else if ([...files.keys()].some(path => /mods\.toml|fabric\.mod\.json/.test(path))) element('project-kind').value = 'mod';
  else element('project-kind').value = 'java';
  const version = requiredJava(files);
  if ([8, 11, 17].includes(version)) element('java-release').value = String(version);
  dirty = false;
  invalidateArtifact();
  selectFile([...files.keys()].find(path => languageFor(path) !== 'BINARY') || files.keys().next().value);
  output(`Открыто ${files.size} файлов.${version > 17 ? ` Проект требует Java ${version}; браузерная JVM поддерживает только Java 8–17. Используйте Gradle локально.` : ''}`);
}

function download(blob, name) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportSources() {
  const zip = new JSZip();
  for (const [path, content] of files) zip.file(path, content);
  download(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), 'mdt-project-sources.zip');
  dirty = false;
}

function publishArtifact(blob, name, diagnostics) {
  invalidateArtifact();
  artifactUrl = URL.createObjectURL(blob);
  element('artifact-download').href = artifactUrl;
  element('artifact-download').download = name;
  element('artifact-download').textContent = `↓ Скачать ${name}`;
  element('artifact-download').hidden = false;
  output(diagnostics, 'Сборка завершена');
}

function browserCompile(sources, release) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    compilerFrame = document.createElement('iframe');
    compilerFrame.hidden = true;
    compilerFrame.title = 'Браузерный компилятор Java';
    compilerFrame.src = 'compiler.html';
    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      compilerFrame?.remove();
      compilerFrame = null;
      stopCompiler = null;
    };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Время ожидания javac истекло. Проверьте доступность CheerpJ и попробуйте ещё раз.')); }, 240000);
    function onMessage(event) {
      if (event.origin !== location.origin || event.source !== compilerFrame?.contentWindow || event.data?.source !== 'mdt-javac') return;
      const data = event.data;
      if (data.type === 'ready') compilerFrame.contentWindow.postMessage({ type: 'compile', id, sources, dependencies, release }, location.origin);
      else if (data.id !== id) return;
      else if (data.type === 'progress') output(data.message, 'Компиляция…');
      else if (data.type === 'result') { cleanup(); resolve(data); }
      else if (data.type === 'error') { cleanup(); reject(new Error(data.message)); }
    }
    window.addEventListener('message', onMessage);
    stopCompiler = () => { cleanup(); reject(new Error('Компиляция остановлена.')); };
    document.body.append(compilerFrame);
  });
}

async function compile() {
  if (compiling) return;
  invalidateArtifact();
  compiling = true;
  for (const id of ['compile-project', 'project-kind', 'import-project', 'import-dependencies', 'clear-dependencies', 'remove-file', 'new-file-path']) element(id).disabled = true;
  element('source-editor').readOnly = true;
  element('cancel-compile').hidden = false;
  try {
    if (!files.size) throw new Error('Добавьте файлы проекта.');
    for (const [path, content] of files) {
      if (/\.(json|mcmeta)$/.test(path) && typeof content === 'string') {
        try { JSON.parse(content); } catch (error) { throw new Error(`${path}: ${error.message}`); }
      }
    }
    const kind = element('project-kind').value;
    const zip = new JSZip();
    if (kind === 'datapack' || kind === 'web') {
      if (kind === 'datapack') {
        const meta = files.get('pack.mcmeta');
        if (typeof meta !== 'string') throw new Error('Датапак должен содержать pack.mcmeta в корне.');
        const pack = JSON.parse(meta).pack;
        if (!Number.isInteger(pack?.pack_format) || pack.pack_format < 1 || !pack.description) throw new Error('Проверьте pack.pack_format и pack.description в pack.mcmeta.');
        if ([...files.keys()].some(path => path.endsWith('.java'))) throw new Error('Датапаки не содержат Java-код. Выберите тип Java / мод / плагин.');
      }
      for (const [path, content] of files) zip.file(path, content);
      publishArtifact(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), kind === 'datapack' ? 'mdt-datapack.zip' : 'mdt-web.zip', kind === 'datapack' ? 'JSON проверен. Датапак упакован в ZIP. Команды mcfunction проверяются Minecraft при /reload, не javac.' : 'Веб-файлы упакованы в ZIP. HTML/CSS/JS выполняются в браузере, не javac.');
      return;
    }
    const version = requiredJava(files);
    if (version > 17) throw new Error(`Проект требует Java ${version}. Браузерный javac поддерживает Java 8, 11 и 17. Скачайте исходники и выполните Gradle-сборку с нужным JDK.`);
    const sources = [...files].filter(([path, content]) => path.endsWith('.java') && typeof content === 'string').map(([path, content]) => ({ path, content }));
    if (!sources.length) throw new Error('В проекте нет Java-файлов.');
    if (sources.length > 150 || sources.reduce((total, source) => total + encoder.encode(source.content).length, 0) > 4 * 1024 * 1024) throw new Error('Максимум 150 Java-файлов и 4 МБ исходников.');
    if (kind === 'plugin' && ![...files.keys()].some(path => /(?:^|\/)(?:paper-)?plugin\.yml$/.test(path))) throw new Error('Для плагина нужен plugin.yml или paper-plugin.yml.');
    const result = await browserCompile(sources, Number(element('java-release').value));
    if (result.exitCode !== 0) { output(result.diagnostics || `javac завершился с кодом ${result.exitCode}`, 'Ошибка компиляции'); return; }
    if (!result.classes.length) throw new Error('javac не создал .class-файлы. JAR не сформирован.');
    for (const file of result.classes) zip.file(file.path, await file.blob.arrayBuffer());
    for (const [path, content] of files) {
      const destination = resourcePath(path);
      if (destination) zip.file(destination, content);
    }
    const modWarning = kind === 'mod' ? '\nЭто dev-JAR: remap/reobfuscation не выполнены. Для установки мода выполните полную Gradle-сборку.' : '';
    publishArtifact(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/java-archive' }), kind === 'mod' ? 'mdt-mod-dev.jar' : kind === 'plugin' ? 'mdt-plugin.jar' : 'mdt-classes.jar', `${result.diagnostics || 'javac: ошибок нет.'}\nСоздано ${result.classes.length} .class-файлов.${modWarning}`);
  } catch (error) { output(error.message || 'Ошибка сборки.', 'Сборка не выполнена'); }
  finally {
    compiling = false;
    for (const id of ['compile-project', 'project-kind', 'import-project', 'import-dependencies', 'clear-dependencies', 'remove-file', 'new-file-path']) element(id).disabled = false;
    element('source-editor').readOnly = false;
    element('cancel-compile').hidden = true;
  }
}

function preview() {
  const htmlPath = files.has('index.html') ? 'index.html' : [...files.keys()].find(path => path.endsWith('.html'));
  if (!htmlPath) return output('Добавьте HTML-файл для веб-просмотра.', 'Нет HTML');
  const parser = new DOMParser();
  const documentPreview = parser.parseFromString(files.get(htmlPath), 'text/html');
  for (const node of documentPreview.querySelectorAll('link[href], script[src]')) {
    const attribute = node.tagName === 'LINK' ? 'href' : 'src';
    let path;
    try { path = new URL(node.getAttribute(attribute), `https://mdt.invalid/${htmlPath}`).pathname.slice(1); } catch { continue; }
    const content = files.get(path);
    if (typeof content === 'string') node.setAttribute(attribute, `data:${attribute === 'href' ? 'text/css' : 'text/javascript'};charset=utf-8,${encodeURIComponent(content)}`);
  }
  element('web-preview').srcdoc = '<!doctype html>' + documentPreview.documentElement.outerHTML;
  element('preview-panel').hidden = false;
}

element('source-editor').addEventListener('input', () => {
  files.set(selectedPath, element('source-editor').value);
  changed();
});
element('source-editor').addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  event.preventDefault();
  const editor = element('source-editor');
  editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
  editor.dispatchEvent(new Event('input'));
});
element('source-editor').addEventListener('keyup', () => { element('editor-position').textContent = `Строка ${element('source-editor').value.slice(0, element('source-editor').selectionStart).split('\n').length}`; });
element('add-file-form').addEventListener('submit', event => {
  event.preventDefault();
  if (compiling) return;
  const path = element('new-file-path').value.trim();
  if (!safeProjectPath(path) || languageFor(path) === 'BINARY') return output('Укажите безопасный путь с расширением .java, .html, .css, .js, .json, .mcfunction, .yml, .toml или .txt.', 'Недопустимый путь');
  if (files.has(path)) return output('Такой файл уже есть.', 'Файл существует');
  files.set(path, '');
  changed();
  selectFile(path);
  element('new-file-path').value = '';
});
element('remove-file').addEventListener('click', () => {
  if (!selectedPath || compiling) return;
  files.delete(selectedPath);
  changed();
  const next = files.keys().next().value;
  if (next) selectFile(next);
  else { selectedPath = null; renderFiles(); element('source-editor').value = ''; element('source-editor').disabled = true; }
});
element('project-kind').addEventListener('change', () => {
  if (isTemplate && !dirty) template(element('project-kind').value);
  else output('Тип сборки изменён. Файлы проекта сохранены без изменений.');
  invalidateArtifact();
});
element('java-release').addEventListener('change', invalidateArtifact);
element('import-project').addEventListener('click', () => {
  if (dirty) return output('Сначала скачайте исходники ZIP, чтобы сохранить текущие изменения.', 'Несохранённые правки');
  element('project-upload').click();
});
element('project-upload').addEventListener('change', async () => {
  const file = element('project-upload').files[0];
  if (!file) return;
  try {
    if (file.name.endsWith('.zip')) await importArchive(file);
    else {
      if (file.size > 4 * 1024 * 1024 || !safeProjectPath(file.name) || languageFor(file.name) === 'BINARY') throw new Error('Неподдерживаемый или слишком большой файл.');
      files.set(file.name, await file.text());
      changed();
      selectFile(file.name);
    }
  } catch (error) { output(error.message, 'Импорт не выполнен'); }
  element('project-upload').value = '';
});
element('export-project').addEventListener('click', () => exportSources().catch(error => output(error.message, 'Ошибка экспорта')));
element('compile-project').addEventListener('click', compile);
element('cancel-compile').addEventListener('click', () => stopCompiler?.());
element('preview-project').addEventListener('click', preview);
element('close-preview').addEventListener('click', () => { element('preview-panel').hidden = true; element('web-preview').srcdoc = ''; });
element('import-dependencies').addEventListener('click', () => element('dependency-upload').click());
element('dependency-upload').addEventListener('change', async () => {
  const uploaded = [...element('dependency-upload').files];
  if (uploaded.some(file => !file.name.endsWith('.jar')) || [...dependencies.map(entry => entry.blob), ...uploaded].reduce((total, file) => total + file.size, 0) > 32 * 1024 * 1024) return output('Добавляйте только JAR; общий размер зависимостей — не более 32 МБ.');
  for (const blob of uploaded) dependencies.push({ name: blob.name, blob });
  invalidateArtifact();
  element('dependency-list').textContent = dependencies.map(entry => entry.name).join(', ');
  element('dependency-upload').value = '';
});
element('clear-dependencies').addEventListener('click', () => { dependencies.length = 0; invalidateArtifact(); element('dependency-list').textContent = 'Без зависимостей'; });
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('message', async event => {
  if (event.origin !== location.origin || event.source !== window.opener || event.data?.type !== 'mdt-open-project' || !(event.data.archive instanceof Blob)) return;
  try { await importArchive(event.data.archive, event.data.kind); } catch (error) { output(error.message, 'Импорт не выполнен'); }
});
template('java');
if (window.opener) window.opener.postMessage({ type: 'mdt-workspace-ready' }, location.origin);
