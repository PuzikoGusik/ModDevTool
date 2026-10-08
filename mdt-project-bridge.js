(() => {
  let latestProject;
  const builders = [
    [window.MDTJarBuilder, 'buildModProject', 'mod'],
    [window.MDTPlugin, 'build', 'plugin'],
    [window.MDTDatapack, 'build', 'datapack'],
  ];
  for (const [builder, method, kind] of builders) {
    if (!builder?.[method]) continue;
    const original = builder[method];
    builder[method] = async function (...args) {
      const result = await original.apply(this, args);
      latestProject = { archive: result instanceof Blob ? result : result.blob, kind };
      const button = document.getElementById('mdt-edit-generated');
      if (button) { button.disabled = false; button.title = 'Открыть исходники последнего проекта'; }
      return result;
    };
  }
  document.getElementById('mdt-edit-generated')?.addEventListener('click', () => {
    if (!latestProject?.archive) return;
    const project = latestProject;
    const editor = window.open('workspace.html', '_blank');
    if (!editor) { window.showToast?.('Разрешите открытие новой вкладки для редактора.'); return; }
    const listener = event => {
      if (event.origin !== location.origin || event.source !== editor || event.data?.type !== 'mdt-workspace-ready') return;
      editor.postMessage({ type: 'mdt-open-project', ...project }, location.origin);
      window.removeEventListener('message', listener);
    };
    window.addEventListener('message', listener);
    setTimeout(() => window.removeEventListener('message', listener), 30000);
  });
})();
