// ======================== STATE ========================
let currentUser = null;
let allStudents = [];
let sessionTaps = 0;
let sessionEarned = 0;
let lastTapTime = 0;

// ======================== INIT ========================
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
});

async function checkAuth() {
  const data = await apiFetch('/api/me');
  if (data.logged_in) {
    currentUser = data;
    showApp();
  } else {
    showAuthOverlay();
  }
}

function showAuthOverlay() {
  document.getElementById('auth-overlay').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-overlay').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  updateUserUI();
  loadStudents();
  if (currentUser.is_admin) {
    document.getElementById('nav-admin').classList.remove('hidden');
  }
}

function updateUserUI() {
  document.getElementById('user-display-name').textContent = currentUser.display_name;
  document.getElementById('balance-amount').textContent = currentUser.rubles.toLocaleString('ru-RU');
  document.getElementById('tapper-balance').textContent = currentUser.rubles.toLocaleString('ru-RU');
}

// ======================== AUTH ========================
function switchTab(tab) {
  document.getElementById('form-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('form-register').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
}

async function doLogin(e) {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  const data = await apiFetch('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username: document.getElementById('login-username').value, password: document.getElementById('login-password').value })
  });
  if (data.error) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
  currentUser = await apiFetch('/api/me');
  showApp();
}

async function doRegister(e) {
  e.preventDefault();
  const errEl = document.getElementById('reg-error');
  errEl.classList.add('hidden');
  const data = await apiFetch('/api/register', {
    method: 'POST',
    body: JSON.stringify({
      username: document.getElementById('reg-username').value,
      password: document.getElementById('reg-password').value,
      display_name: document.getElementById('reg-display').value
    })
  });
  if (data.error) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
  showToast(data.message, 'success');
  currentUser = await apiFetch('/api/me');
  showApp();
}

async function doLogout() {
  await apiFetch('/api/logout', { method: 'POST' });
  currentUser = null;
  closeUserMenu();
  showAuthOverlay();
}

function showUserMenu() {
  const menu = document.getElementById('user-menu');
  menu.classList.toggle('hidden');
}

function closeUserMenu() {
  document.getElementById('user-menu').classList.add('hidden');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.user-info') && !e.target.closest('.user-menu')) closeUserMenu();
});

// ======================== NAVIGATION ========================
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  document.getElementById(`nav-${name}`).classList.add('active');
  if (name === 'admin') loadAdminData();
  if (name === 'inventory') loadInventory();
  if (name === 'market') loadStudents();
}

// ======================== STUDENTS ========================
async function loadStudents() {
  allStudents = await apiFetch('/api/students');
  filterStudents();
}

function renderStudents(students) {
  const grid = document.getElementById('students-grid');
  if (!students.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Нет учеников для продажи.<br>Стань первым продавцом!</p></div>`;
    return;
  }
  grid.innerHTML = students.map(s => `
    <div class="student-card ${s.status}" onclick="openStudent('${s._id || s.id}')">
      <span class="status-badge ${s.status === 'available' ? 'status-available' : 'status-sold'}">
        ${s.status === 'available' ? '✅ Доступен' : '🔴 Продан'}
      </span>
      <div class="student-card-img">
        ${s.photo ? `<img src="${s.photo}" alt="${escHtml(s.name)}" loading="lazy">` : '🧒'}
      </div>
      <div class="student-card-body">
        <div class="student-card-name">${escHtml(s.name)}</div>
        <div class="student-card-desc">${escHtml(s.description || 'Без описания')}</div>
        <div class="student-card-footer">
          <span class="student-card-price">${s.price.toLocaleString('ru-RU')} ₽</span>
          <span class="student-card-seller">от ${escHtml(s.seller_name)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function filterStudents() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const status = document.getElementById('filter-status').value;
  const filtered = allStudents.filter(s => {
    const matchQ = s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q);
    const matchStatus = status === 'all' || s.status === status;
    return matchQ && matchStatus;
  });
  renderStudents(filtered);
}

function openStudent(rawId) {
  const id = String(rawId);
  const s = allStudents.find(x => (x._id || x.id) === id);
  if (!s) return;
  const sid = s._id || s.id;
  const isSeller = currentUser && s.seller_id === currentUser.id;
  const canBuy = s.status === 'available' && !isSeller;
  const isAdmin = currentUser && currentUser.is_admin;

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-img">
      ${s.photo ? `<img src="${s.photo}" alt="${escHtml(s.name)}">` : '<span style="font-size:6rem">🧒</span>'}
    </div>
    <div class="modal-body">
      <div class="modal-name">${escHtml(s.name)}</div>
      <div class="modal-meta">
        <span class="modal-price">${s.price.toLocaleString('ru-RU')} ₽</span>
        <span class="status-badge modal-status-badge ${s.status === 'available' ? 'status-available' : 'status-sold'}">
          ${s.status === 'available' ? '✅ Доступен' : '🔴 Продан'}
        </span>
      </div>
      <p class="modal-desc">${escHtml(s.description || 'Описание не указано.')}</p>
      <p class="modal-seller">👤 Продавец: <strong>${escHtml(s.seller_name)}</strong></p>
      ${s.buyer_name ? `<p class="modal-buyer">🎓 Куплен пользователем: <strong>${escHtml(s.buyer_name)}</strong></p>` : ''}
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${canBuy ? `<button class="btn btn-primary" onclick="buyStudent('${sid}')">🛒 Купить за ${s.price.toLocaleString('ru-RU')} ₽</button>` : ''}
        ${isSeller && s.status === 'available' ? `<button class="btn btn-danger" onclick="deleteStudent('${sid}')">🗑️ Снять с продажи</button>` : ''}
        ${isAdmin && !isSeller && s.status === 'available' ? `<button class="btn btn-danger" onclick="deleteStudent('${sid}')">🗑️ Удалить (Админ)</button>` : ''}
      </div>
    </div>
  `;
  document.getElementById('student-modal').classList.remove('hidden');
}

async function buyStudent(id) {
  const data = await apiFetch(`/api/students/${id}/buy`, { method: 'POST' });
  if (data.error) { showToast(data.error, 'error'); return; }
  showToast(data.message, 'success');
  closeStudentModal();
  currentUser = await apiFetch('/api/me');
  updateUserUI();
  await loadStudents();
}

async function deleteStudent(id) {
  if (!confirm('Снять ученика с продажи?')) return;
  const data = await apiFetch(`/api/students/${id}`, { method: 'DELETE' });
  if (data.error) { showToast(data.error, 'error'); return; }
  showToast('Объявление удалено', 'info');
  closeStudentModal();
  await loadStudents();
}

function closeStudentModal() {
  document.getElementById('student-modal').classList.add('hidden');
}

function closeModal(e) {
  if (e.target === document.getElementById('student-modal')) closeStudentModal();
}

// ======================== SELL FORM ========================
function previewPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById('photo-preview-img').src = ev.target.result;
    document.getElementById('photo-preview-img').classList.remove('hidden');
    document.getElementById('photo-placeholder').classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

async function submitStudent(e) {
  e.preventDefault();
  const errEl = document.getElementById('sell-error');
  const successEl = document.getElementById('sell-success');
  errEl.classList.add('hidden');
  successEl.classList.add('hidden');

  const name = document.getElementById('s-name').value.trim();
  const price = document.getElementById('s-price').value.trim();
  const desc = document.getElementById('s-desc').value.trim();
  const photoFile = document.getElementById('photo-input').files[0];

  const formData = new FormData();
  formData.append('name', name);
  formData.append('price', price);
  formData.append('description', desc);
  if (photoFile) formData.append('photo', photoFile);

  const res = await fetch('/api/students', { method: 'POST', body: formData });
  const data = await res.json();
  if (data.error) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }

  successEl.textContent = `🎉 Ученик выставлен на продажу! Комиссия 250 ₽ списана.`;
  successEl.classList.remove('hidden');
  document.getElementById('sell-form').reset();
  document.getElementById('photo-preview-img').classList.add('hidden');
  document.getElementById('photo-placeholder').classList.remove('hidden');
  
  // Refresh balance and students
  currentUser = await apiFetch('/api/me');
  updateUserUI();
  await loadStudents();
  setTimeout(() => { showPage('market'); }, 1500);
}

// ======================== INVENTORY ========================
let myStudents = [];

async function loadInventory() {
  const grid = document.getElementById('inventory-grid');
  grid.innerHTML = '<div class="loading-spinner">Загружаем...</div>';
  myStudents = await apiFetch('/api/my-students');
  renderInventory();
}

function renderInventory() {
  const grid = document.getElementById('inventory-grid');
  if (!Array.isArray(myStudents) || !myStudents.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🎒</div><p>Инвентарь пуст.<br>Иди и купи кого-нибудь на маркете!</p></div>`;
    return;
  }
  grid.innerHTML = myStudents.map(s => `
    <div class="student-card available">
      <span class="status-badge status-available">🎒 Твой</span>
      <div class="student-card-img">
        ${s.photo ? `<img src="${s.photo}" alt="${escHtml(s.name)}" loading="lazy">` : '🧒'}
      </div>
      <div class="student-card-body">
        <div class="student-card-name">${escHtml(s.name)}</div>
        <div class="student-card-desc">${escHtml(s.description || 'Без описания')}</div>
        <div class="student-card-footer">
          <span class="student-card-price">Куплен за ${s.price.toLocaleString('ru-RU')} ₽</span>
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:10px" onclick="openResellModal('${s._id || s.id}', '${escHtml(s.name)}', ${s.price})">🔄 Перепродать</button>
      </div>
    </div>
  `).join('');
}

// Resell modal (inline simple prompt approach)
function openResellModal(sid, name, oldPrice) {
  const newPrice = prompt(`Перепродать «${name}»\nВведи новую цену в рублях:`, oldPrice);
  if (!newPrice || isNaN(newPrice) || parseInt(newPrice) < 1) return;
  doResell(sid, parseInt(newPrice));
}

async function doResell(sid, price) {
  const data = await apiFetch(`/api/students/${sid}/resell`, {
    method: 'POST',
    body: JSON.stringify({ price })
  });
  if (data.error) { showToast(data.error, 'error'); return; }
  showToast(data.message, 'success');
  await loadInventory();
  await loadStudents();
}

// ======================== TAPPER ========================
async function doTap() {
  const now = Date.now();
  if (now - lastTapTime < 80) return; // basic rate limit
  lastTapTime = now;
  
  sessionTaps++;
  sessionEarned++;
  document.getElementById('session-taps').textContent = sessionTaps;
  document.getElementById('session-earned').textContent = sessionEarned + ' ₽';
  
  // Optimistic UI update
  currentUser.rubles += 1;
  document.getElementById('balance-amount').textContent = currentUser.rubles.toLocaleString('ru-RU');
  document.getElementById('tapper-balance').textContent = currentUser.rubles.toLocaleString('ru-RU');
  
  // Coin burst animation
  spawnCoinParticle();

  try {
    const data = await apiFetch('/api/tap', { method: 'POST', body: JSON.stringify({ taps: 1 }) });
    if (data.rubles !== undefined) {
      currentUser.rubles = data.rubles;
      document.getElementById('balance-amount').textContent = data.rubles.toLocaleString('ru-RU');
      document.getElementById('tapper-balance').textContent = data.rubles.toLocaleString('ru-RU');
    }
  } catch (err) { /* ignore */ }
}

function spawnCoinParticle() {
  const btn = document.getElementById('tapper-btn');
  const rect = btn.getBoundingClientRect();
  const tapperArea = document.querySelector('.tapper-area');
  const areaRect = tapperArea.getBoundingClientRect();

  // +1 ₽ float
  const plusEl = document.createElement('div');
  plusEl.className = 'tap-plus';
  plusEl.textContent = '+1 ₽';
  plusEl.style.left = (rect.left - areaRect.left + rect.width / 2 - 20) + 'px';
  plusEl.style.top = (rect.top - areaRect.top) + 'px';
  tapperArea.style.position = 'relative';
  tapperArea.appendChild(plusEl);
  setTimeout(() => plusEl.remove(), 700);

  // Coin
  const coin = document.createElement('div');
  coin.className = 'coin-particle';
  const angle = Math.random() * Math.PI * 2;
  const dist = 50 + Math.random() * 60;
  coin.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
  coin.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
  coin.textContent = '💰';
  document.getElementById('coin-burst').appendChild(coin);
  setTimeout(() => coin.remove(), 900);
}

// ======================== ADMIN ========================
async function loadAdminData() {
  const users = await apiFetch('/api/admin/users');
  if (!Array.isArray(users)) return;
  
  // Populate select
  const sel = document.getElementById('admin-user-select');
  sel.innerHTML = '<option value="">Выбери пользователя...</option>';
  
  // Render users list
  const list = document.getElementById('admin-users-list');
  list.innerHTML = users.map(u => `
    <div class="admin-user-row">
      <div class="admin-user-info">
        <div class="admin-user-name">${escHtml(u.display_name)} ${u.is_admin ? '<span class="admin-badge">ДИРЕКТОР</span>' : ''}</div>
        <div class="admin-user-sub">@${escHtml(u.username)}</div>
      </div>
      <div class="admin-user-balance">${u.rubles.toLocaleString('ru-RU')} ₽</div>
    </div>
  `).join('');
  
  users.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `${u.display_name} (@${u.username}) — ${u.rubles} ₽`;
    sel.appendChild(opt);
  });
}

async function adminGiveRubles() {
  const errEl = document.getElementById('admin-give-error');
  const successEl = document.getElementById('admin-give-success');
  errEl.classList.add('hidden');
  successEl.classList.add('hidden');
  
  const user_id = document.getElementById('admin-user-select').value;
  const amount = document.getElementById('admin-amount').value;
  
  if (!user_id) { errEl.textContent = 'Выбери пользователя!'; errEl.classList.remove('hidden'); return; }
  if (!amount || amount < 1) { errEl.textContent = 'Введи сумму!'; errEl.classList.remove('hidden'); return; }
  
  const data = await apiFetch('/api/admin/give-rubles', {
    method: 'POST',
    body: JSON.stringify({ user_id, amount: parseInt(amount) })
  });
  
  if (data.error) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
  
  successEl.textContent = `✅ ${data.message}`;
  successEl.classList.remove('hidden');
  document.getElementById('admin-amount').value = '';
  await loadAdminData();
  
  // Refresh self balance if needed
  currentUser = await apiFetch('/api/me');
  updateUserUI();
}

// ======================== UTILITIES ========================
async function apiFetch(url, options = {}) {
  const defaults = {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  };
  if (options.body && typeof options.body === 'string') {
    options.headers = { ...defaults.headers, ...options.headers };
  } else if (options.body instanceof FormData) {
    // No Content-Type header for FormData
    delete defaults.headers['Content-Type'];
  }
  const res = await fetch(url, { ...defaults, ...options });
  return res.json();
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  t.onclick = () => t.remove();
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(80px)'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}
