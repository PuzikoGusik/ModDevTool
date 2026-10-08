let busy = false;
let activeId;

function notify(type, payload = {}) {
  window.parent.postMessage({ source: 'mdt-javac', id: activeId, type, ...payload }, location.origin);
}

async function javaStrings(lib, values) {
  const Class = await lib.java.lang.Class;
  const Array = await lib.java.lang.reflect.Array;
  const array = await Array.newInstance(await Class.forName('java.lang.String'), values.length);
  for (let index = 0; index < values.length; index++) array[index] = values[index];
  return array;
}

async function classesIn(lib, root, prefix = '') {
  const File = await lib.java.io.File;
  const children = await (await new File(root)).listFiles();
  const output = [];
  for (let index = 0; index < (children?.length || 0); index++) {
    const child = children[index];
    const name = await child.getName();
    const path = `${root}/${name}`;
    if (await child.isDirectory()) output.push(...await classesIn(lib, path, `${prefix}${name}/`));
    else if (name.endsWith('.class')) output.push({ path: `${prefix}${name}`, blob: new Blob([await (await cjFileBlob(path)).arrayBuffer()]) });
  }
  return output;
}

async function removeTree(lib, path) {
  const File = await lib.java.io.File;
  const file = await new File(path);
  if (await file.isDirectory()) {
    const children = await file.listFiles();
    for (let index = 0; index < (children?.length || 0); index++) await removeTree(lib, await children[index].getPath());
  }
  await file.delete();
}

window.addEventListener('message', async event => {
  if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'compile' || busy) return;
  busy = true;
  activeId = event.data.id;
  const { sources, dependencies, release } = event.data;
  if (!Array.isArray(sources) || !Array.isArray(dependencies) || ![8, 11, 17].includes(Number(release))) {
    notify('error', { message: 'Invalid compilation request.' });
    return;
  }
  const root = `/files/mdt-${crypto.randomUUID()}`;
  const stringFiles = [];
  let lib;
  let completion;
  try {
    notify('progress', { message: 'Загрузка JVM Java 17 и javac… Первый запуск может занять несколько минут.' });
    await cheerpjInit({ version: 17, status: 'none' });
    const compilerResponse = await fetch('assets/javac17.jar');
    if (!compilerResponse.ok) throw new Error('Не удалось загрузить OpenJDK javac.');
    const compilerPath = '/str/mdt-javac17-runtime.jar';
    cheerpOSAddStringFile(compilerPath, new Uint8Array(await compilerResponse.arrayBuffer()));
    stringFiles.push(compilerPath);
    lib = await cheerpjRunLibrary(compilerPath);
    const JavacMain = await lib.com.sun.tools.javac.Main;
    const File = await lib.java.io.File;
    const FileOutputStream = await lib.java.io.FileOutputStream;
    const OutputStreamWriter = await lib.java.io.OutputStreamWriter;
    const outDir = `${root}/classes`;
    if (!await (await new File(outDir)).mkdirs()) throw new Error('Не удалось создать каталог компиляции.');
    const javaHome = `${root}/jdk`;
    await (await new File(`${javaHome}/lib`)).mkdirs();
    const platformResponse = await fetch('assets/openjdk/platforms.ct.sym');
    if (!platformResponse.ok) throw new Error('Не удалось загрузить сигнатуры Java API.');
    const platformStream = await new FileOutputStream(`${javaHome}/lib/ct.sym`);
    await platformStream.write(new Int8Array(await platformResponse.arrayBuffer()));
    await platformStream.close();
    const System = await lib.java.lang.System;
    await System.setProperty('java.home', javaHome);
    const sourcePaths = [];
    for (let index = 0; index < sources.length; index++) {
      const source = sources[index];
      const filename = source.path.split('/').pop();
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*\.java$/.test(filename)) throw new Error('Некорректное имя Java-файла.');
      const directory = `${root}/sources/${index}`;
      await (await new File(directory)).mkdirs();
      const path = `${directory}/${filename}`;
      const sourceWriter = await new OutputStreamWriter(await new FileOutputStream(path), 'UTF-8');
      await sourceWriter.write(source.content);
      await sourceWriter.close();
      sourcePaths.push(path);
    }
    const classpath = [];
    for (let index = 0; index < dependencies.length; index++) {
      const path = `/str/mdt-${activeId}-dependency-${index}.jar`;
      cheerpOSAddStringFile(path, new Uint8Array(await dependencies[index].blob.arrayBuffer()));
      stringFiles.push(path);
      classpath.push(path);
    }
    const OutputStream = await lib.java.io.ByteArrayOutputStream;
    const output = await new OutputStream();
    const PrintWriter = await lib.java.io.PrintWriter;
    const writer = await new PrintWriter(output, true);
    const options = ['-proc:none', '-encoding', 'UTF-8', '--release', String(release), '-d', outDir];
    if (classpath.length) options.push('-classpath', classpath.join(':'));
    const args = await javaStrings(lib, [...options, ...sourcePaths]);
    notify('progress', { message: `javac --release ${release}: ${sources.length} Java-файлов…` });
    const exitCode = await JavacMain.compile(args, writer);
    await writer.flush();
    let diagnostics = await output.toString('UTF-8');
    for (let index = 0; index < sourcePaths.length; index++) diagnostics = diagnostics.split(sourcePaths[index]).join(sources[index].path);
    const classes = exitCode === 0 ? await classesIn(lib, outDir) : [];
    completion = { type: 'result', payload: { exitCode, diagnostics, classes } };
  } catch (error) {
    let message = error.message;
    try { if (!message && error.getMessage) message = await error.getMessage(); } catch {}
    try { if (!message && error.toString) message = await error.toString(); } catch {}
    completion = { type: 'error', payload: { message: message || 'Ошибка браузерного javac. Компиляция не выполнена.' } };
  } finally {
    for (const path of stringFiles) cheerpOSRemoveStringFile(path);
    if (lib) { try { await removeTree(lib, root); } catch {} }
    if (completion) notify(completion.type, completion.payload);
  }
});
window.parent.postMessage({ source: 'mdt-javac', type: 'ready' }, location.origin);
