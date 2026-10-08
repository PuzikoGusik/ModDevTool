export function safeProjectPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 180 && !path.startsWith('/') && !path.includes('\\') && !/[\x00-\x1f:]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
}

export function languageFor(path) {
  const extension = path.split('.').pop().toLowerCase();
  return ({ java: 'JAVA', css: 'CSS', html: 'HTML', js: 'JAVASCRIPT', json: 'JSON', mcmeta: 'JSON', mcfunction: 'MCFUNCTION', yml: 'YAML', yaml: 'YAML', toml: 'TOML', gradle: 'GROOVY', properties: 'PROPERTIES', txt: 'TEXT', md: 'MARKDOWN' })[extension] || 'BINARY';
}

export function requiredJava(files) {
  let version = 0;
  for (const [path, content] of files) {
    if (typeof content !== 'string' || !/(?:build\.gradle|gradle\.properties)$/.test(path)) continue;
    for (const match of content.matchAll(/(?:JavaLanguageVersion\.of\(|java_version\s*=\s*|VERSION_)(\d+)/g)) version = Math.max(version, Number(match[1]));
  }
  return version;
}

export function resourcePath(path) {
  const prefix = 'src/main/resources/';
  if (path.startsWith(prefix)) return path.slice(prefix.length);
  if (path === 'plugin.yml' || path === 'paper-plugin.yml' || path === 'pack.mcmeta' || path.startsWith('assets/') || path.startsWith('data/') || path.startsWith('META-INF/')) return path;
  return null;
}
