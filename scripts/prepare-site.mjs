import { mkdir, copyFile, rm, cp } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('public', { recursive: true, force: true });
await mkdir('public/assets', { recursive: true });
await copyFile('assets/javac17.jar', 'public/assets/javac17.jar');
await cp('assets/openjdk', 'public/assets/openjdk', { recursive: true });
for (const filename of ['index.html', 'robots.txt', 'sitemap.xml', 'mdt-jar-builder.js', 'mdt-gradle-wrapper.js', 'mdt-plugin-builder.js', 'mdt-datapack-builder.js', 'workspace.html', 'compiler.html', 'mdt-workspace.js', 'mdt-compiler.js', 'mdt-code-utils.js', 'mdt-project-bridge.js', 'mdt-features.css']) {
  await copyFile(filename, `public/${filename}`);
}
await build({ entryPoints: ['mdt-auth.js'], outfile: 'public/assets/mdt-auth.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
