import { login, signup, logout, getUser, getSettings, oauthLogin, handleAuthCallback, onAuthChange, requestPasswordRecovery, recoverPassword, updateUser } from '@netlify/identity';

let session = null;
let profile = null;
let currentMode = 'login';
let availabilityRequest;
let nicknameTimer;
let googleEnabled = false;
let googleChecked = false;
let pending = false;

const dialog = document.createElement('dialog');
dialog.className = 'mdt-auth-dialog';
dialog.setAttribute('aria-labelledby', 'mdt-auth-title');
dialog.innerHTML = `
  <button type="button" class="mdt-dialog-close" aria-label="Закрыть">×</button>
  <div class="mdt-eyebrow">MODDEVTOOL / ACCOUNT</div>
  <h2 id="mdt-auth-title">Ваш аккаунт</h2>
  <p class="mdt-muted">Один никнейм. Ваш профиль на любом устройстве.</p>
  <div class="mdt-auth-tabs" role="group" aria-label="Действие с аккаунтом">
    <button type="button" data-mode="login">Вход</button>
    <button type="button" data-mode="signup">Регистрация</button>
    <button type="button" data-mode="recovery">Восстановление</button>
  </div>
  <form id="mdt-auth-form">
    <label id="mdt-nickname-label">Никнейм
      <input id="mdt-nickname" name="nickname" minlength="3" maxlength="20" autocomplete="nickname" aria-describedby="mdt-nickname-status">
      <span id="mdt-nickname-status" class="mdt-field-status" role="status" aria-live="polite">3–20 букв, цифр, пробелов, _ или -</span>
    </label>
    <label id="mdt-email-label">Email<input id="mdt-email" name="email" type="email" autocomplete="email" maxlength="254"></label>
    <label id="mdt-code-label">Код или ссылка из письма
      <input id="mdt-recovery-code" name="code" autocomplete="off" spellcheck="false">
      <span class="mdt-field-status">Вставьте recovery_token из ссылки или всю ссылку. Это одноразовый код Netlify, не шестизначный PIN.</span>
    </label>
    <label id="mdt-password-label">Пароль<input id="mdt-password" name="password" type="password" minlength="10" autocomplete="current-password" maxlength="256"></label>
    <label id="mdt-repeat-label">Повторите пароль<input id="mdt-repeat" type="password" minlength="10" autocomplete="new-password" maxlength="256"></label>
    <p id="mdt-auth-status" class="mdt-auth-status" role="status" aria-live="polite"></p>
    <button class="btn btn-primary mdt-auth-submit" id="mdt-auth-submit" type="submit">Войти</button>
  </form>
  <button type="button" id="mdt-use-code" class="mdt-text-button">Уже есть код из письма</button>
  <div id="mdt-google-section"><div class="mdt-divider">или</div><button type="button" id="mdt-google" class="mdt-google-button" disabled><span aria-hidden="true">G</span> Продолжить с Google</button><p id="mdt-google-note" class="mdt-field-status">Проверка Google…</p></div>
  <button type="button" id="mdt-logout" class="mdt-text-button">Выйти из аккаунта</button>
`;
document.body.append(dialog);
const element = id => dialog.querySelector(`#${id}`);
const form = element('mdt-auth-form');
const inputNickname = element('mdt-nickname');

function status(message, error = false) {
  element('mdt-auth-status').textContent = message;
  element('mdt-auth-status').classList.toggle('mdt-error', error);
}

function normalizeNickname(value) {
  return value.normalize('NFKC').trim().replace(/ +/g, ' ');
}

function setMode(mode) {
  currentMode = mode;
  status('');
  const usesNickname = ['signup', 'profile'].includes(mode);
  const usesEmail = ['signup', 'login', 'recovery'].includes(mode);
  const usesPassword = ['signup', 'login', 'reset', 'code'].includes(mode);
  for (const [id, visible] of [['mdt-nickname-label', usesNickname], ['mdt-email-label', usesEmail], ['mdt-password-label', usesPassword], ['mdt-repeat-label', ['signup', 'reset', 'code'].includes(mode)], ['mdt-code-label', mode === 'code'], ['mdt-use-code', mode === 'recovery'], ['mdt-logout', Boolean(session)], ['mdt-google-section', ['signup', 'login'].includes(mode)]]) element(id).hidden = !visible;
  inputNickname.required = usesNickname;
  element('mdt-email').required = usesEmail;
  element('mdt-password').required = usesPassword;
  element('mdt-password').minLength = mode === 'login' ? 1 : 10;
  element('mdt-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  element('mdt-repeat').required = ['signup', 'reset', 'code'].includes(mode);
  element('mdt-recovery-code').required = mode === 'code';
  element('mdt-password').value = '';
  element('mdt-repeat').value = '';
  const titles = { login: 'С возвращением', signup: 'Создать аккаунт', recovery: 'Восстановить доступ', reset: 'Новый пароль', code: 'Восстановление по коду', profile: profile ? 'Ваш аккаунт' : 'Выберите свой никнейм' };
  element('mdt-auth-title').textContent = titles[mode];
  element('mdt-auth-submit').textContent = { login: 'Войти', signup: 'Зарегистрироваться', recovery: 'Отправить письмо', reset: 'Сохранить пароль', code: 'Подтвердить код и пароль', profile: 'Сохранить никнейм' }[mode];
  dialog.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  if (mode === 'profile') inputNickname.value = profile?.nickname || '';
  if (usesNickname) checkNickname();
}

function open(mode = session ? 'profile' : 'login') {
  setMode(mode);
  if (!dialog.open) dialog.showModal();
}

function updateAccount() {
  const button = document.getElementById('mdt-account-button');
  if (button) button.textContent = session ? (profile?.nickname || 'Выбрать никнейм') : 'Войти';
  if (typeof currentUser !== 'undefined') {
    currentUser.id = session?.id || 'guest';
    currentUser.nickname = profile?.nickname || 'Гость';
    currentUser.role = 'user';
    currentUser.avatar = '👤';
    if (typeof updateTopbarProfileAvatar === 'function') updateTopbarProfileAvatar();
  }
}

async function accountRequest(method = 'GET', nickname) {
  const response = await fetch('/.netlify/functions/account', {
    method, credentials: 'same-origin',
    ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname }) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result.profile;
}

async function syncSession(user) {
  session = user;
  profile = null;
  updateAccount();
  if (!user?.confirmedAt) return;
  try {
    const loaded = await accountRequest();
    if (session?.id !== user.id) return;
    profile = loaded;
    updateAccount();
    if (!profile && currentMode !== 'reset') open('profile');
  } catch {
    open('profile');
    status('Профиль временно недоступен. Повторите попытку позже.', true);
  }
}

async function checkNickname() {
  availabilityRequest?.abort();
  const controller = new AbortController();
  availabilityRequest = controller;
  const nickname = normalizeNickname(inputNickname.value);
  const output = element('mdt-nickname-status');
  output.classList.remove('mdt-error', 'mdt-success');
  if (!/^[A-Za-zА-Яа-яЁё0-9_ -]{3,20}$/.test(nickname)) {
    output.textContent = '3–20 букв, цифр, пробелов, _ или -';
    inputNickname.setCustomValidity('Проверьте формат никнейма');
    return false;
  }
  if (profile?.nickname.toLowerCase() === nickname.toLowerCase()) {
    output.textContent = 'Это ваш никнейм';
    inputNickname.setCustomValidity('');
    return true;
  }
  output.textContent = 'Проверка никнейма…';
  inputNickname.setCustomValidity('Дождитесь проверки никнейма');
  try {
    const response = await fetch(`/.netlify/functions/nickname?nickname=${encodeURIComponent(nickname)}`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('availability');
    const { available } = await response.json();
    if (nickname !== normalizeNickname(inputNickname.value) || controller !== availabilityRequest) return false;
    output.textContent = available ? '✓ Никнейм свободен' : 'Никнейм занят';
    output.classList.toggle('mdt-error', !available);
    output.classList.toggle('mdt-success', available);
    inputNickname.setCustomValidity(available ? '' : 'Никнейм занят');
    return available;
  } catch (error) {
    if (error.name === 'AbortError') return false;
    output.textContent = 'Не удалось проверить никнейм. Повторите попытку.';
    output.classList.add('mdt-error');
    inputNickname.setCustomValidity('Проверка недоступна');
    return false;
  }
}

inputNickname.addEventListener('input', () => {
  availabilityRequest?.abort();
  clearTimeout(nicknameTimer);
  inputNickname.setCustomValidity('Дождитесь проверки никнейма');
  element('mdt-nickname-status').textContent = 'Проверка никнейма…';
  nicknameTimer = setTimeout(checkNickname, 350);
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending) return;
  const mode = currentMode;
  const password = element('mdt-password').value;
  if (['signup', 'reset', 'code'].includes(mode) && password !== element('mdt-repeat').value) return status('Пароли не совпадают.', true);
  pending = true;
  element('mdt-auth-submit').disabled = true;
  dialog.querySelectorAll('[data-mode], #mdt-google, #mdt-use-code, #mdt-logout').forEach(button => button.disabled = true);
  status('Пожалуйста, подождите…');
  try {
    const email = element('mdt-email').value.trim();
    if (mode === 'login') {
      await syncSession(await login(email, password));
      if (profile) dialog.close();
    } else if (mode === 'signup') {
      if (!await checkNickname()) { status('Выберите свободный никнейм.', true); return; }
      const nickname = normalizeNickname(inputNickname.value);
      const user = await signup(email, password, { full_name: nickname, nickname });
      if (user.confirmedAt) {
        await syncSession(user);
        if (profile) dialog.close();
      } else {
        setMode('login');
        status('Аккаунт создан. Подтвердите email по ссылке в письме, затем войдите.');
      }
    } else if (mode === 'profile') {
      if (!await checkNickname()) { status('Выберите свободный никнейм.', true); return; }
      profile = await accountRequest('POST', normalizeNickname(inputNickname.value));
      updateAccount();
      dialog.close();
    } else if (mode === 'recovery') {
      await requestPasswordRecovery(email);
      status('Если аккаунт существует, на почту отправлено письмо. Откройте ссылку или вставьте её код здесь.');
    } else {
      let user;
      if (mode === 'code') {
        const value = element('mdt-recovery-code').value.trim();
        const token = value.includes('recovery_token=') ? new URLSearchParams(value.split('#').pop()).get('recovery_token') : value;
        if (!token) throw new Error('invalid-recovery');
        user = await recoverPassword(token, password);
        element('mdt-recovery-code').value = '';
      } else user = await updateUser({ password });
      currentMode = 'login';
      await syncSession(user);
      if (profile) dialog.close();
      window.showToast?.('Пароль обновлён.');
    }
  } catch (error) {
    const messages = { 'nickname-busy': 'Никнейм уже занят. Выберите другой.', unauthorized: 'Сначала войдите и подтвердите email.', 'invalid-recovery': 'Код восстановления недействителен.' };
    status(messages[error.message] || (mode === 'login' ? 'Не удалось войти. Проверьте email и пароль.' : mode === 'code' || mode === 'reset' ? 'Код истёк или недействителен. Запросите новое письмо.' : 'Не удалось выполнить запрос. Проверьте данные и попробуйте снова.'), true);
    if (mode === 'signup') await checkNickname();
  } finally {
    pending = false;
    element('mdt-password').value = '';
    element('mdt-repeat').value = '';
    element('mdt-auth-submit').disabled = false;
    dialog.querySelectorAll('[data-mode], #mdt-use-code, #mdt-logout').forEach(button => button.disabled = false);
    element('mdt-google').disabled = !googleEnabled;
  }
});

dialog.querySelector('.mdt-dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { element('mdt-password').value = ''; element('mdt-repeat').value = ''; element('mdt-recovery-code').value = ''; });
dialog.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
element('mdt-use-code').addEventListener('click', () => setMode('code'));
element('mdt-google').addEventListener('click', () => {
  if (googleChecked && googleEnabled) {
    try { oauthLogin('google'); } catch { status('Не удалось открыть Google. Повторите попытку.', true); }
  }
});
element('mdt-logout').addEventListener('click', async () => {
  try { await logout(); await syncSession(null); setMode('login'); } catch { status('Не удалось выйти. Повторите попытку.', true); }
});
document.getElementById('mdt-account-button')?.addEventListener('click', () => open());
window.MDTAccount = { open };
window.registerIdentity = async (nickname, telegram) => {
  if (!session) { open('login'); return { ok: false, error: 'login-required' }; }
  if (telegram && !/^[A-Za-z0-9_]{5,32}$/.test(String(telegram).replace(/^@/, ''))) return { ok: false, error: 'tg-format' };
  try {
    profile = await accountRequest('POST', nickname);
    updateAccount();
    if (typeof currentUser !== 'undefined') currentUser.tg = telegram || '';
    return { ok: true, nickname: profile.nickname, tg: telegram || '' };
  } catch (error) { return { ok: false, error: error.message === 'nickname-busy' ? 'nickname' : 'server-error' }; }
};

async function initialize() {
  try {
    const settings = await getSettings();
    googleEnabled = Boolean(settings.providers.google);
    googleChecked = true;
    element('mdt-google').disabled = !googleEnabled;
    element('mdt-google-note').textContent = googleEnabled ? 'Безопасный вход через Google' : 'Google появится после настройки провайдера в Netlify Identity.';
    if (settings.disableSignup) dialog.querySelector('[data-mode="signup"]').hidden = true;
  } catch { element('mdt-google-note').textContent = 'Сервис входа временно недоступен.'; }
  try {
    const callback = await handleAuthCallback();
    if (callback?.type === 'recovery') {
      currentMode = 'reset';
      await syncSession(callback.user);
      open('reset');
    } else {
      await syncSession(await getUser());
    }
  } catch {
    open('recovery');
    status('Ссылка истекла или недействительна. Запросите новое письмо.', true);
  }
  onAuthChange(async event => {
    if (['login', 'logout', 'user_updated', 'token_refresh'].includes(event)) await syncSession(await getUser());
    if (event === 'recovery') open('reset');
  });
}
initialize();
