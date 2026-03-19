const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Datastore = require('@seald-io/nedb');

const app = express();
const PORT = process.env.PORT || 6134;

// Ensure directories exist
['./uploads', './data'].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// Databases
const usersDB = new Datastore({ filename: './data/users.db', autoload: true });
const studentsDB = new Datastore({ filename: './data/students.db', autoload: true });

// NeDB is an append-only database (like CouchDB). Updates append new lines instead of rewriting the file.
// We must set auto-compaction so the files don't grow infinitely with repeated taps.
usersDB.setAutocompactionInterval(1000 * 60 * 5); // Compact every 5 mins
studentsDB.setAutocompactionInterval(1000 * 60 * 60); // Compact hourly
const tapsDB = new Datastore({ filename: './data/taps.db', autoload: true });

// Indexes
usersDB.ensureIndex({ fieldName: 'username', unique: true });

// Helper: promisify nedb
const dbFind = (db, q, sort) => new Promise((res, rej) => {
  let cursor = db.find(q);
  if (sort) cursor = cursor.sort(sort);
  cursor.exec((err, docs) => err ? rej(err) : res(docs));
});
const dbFindOne = (db, q) => new Promise((res, rej) => db.findOne(q, (err, doc) => err ? rej(err) : res(doc)));
const dbInsert = (db, doc) => new Promise((res, rej) => db.insert(doc, (err, newDoc) => err ? rej(err) : res(newDoc)));
const dbUpdate = (db, q, upd, opts = {}) => new Promise((res, rej) => db.update(q, upd, opts, (err, n) => err ? rej(err) : res(n)));
const dbRemove = (db, q, opts = {}) => new Promise((res, rej) => db.remove(q, opts, (err, n) => err ? rej(err) : res(n)));

// Create default admin
(async () => {
  const admin = await dbFindOne(usersDB, { username: 'admin' });
  if (!admin) {
    const hash = bcrypt.hashSync('sekret5020', 10);
    await dbInsert(usersDB, { username: 'admin', password: hash, display_name: 'Директор', rubles: 999999, is_admin: true, created_at: new Date() });
    console.log('✅ Admin created: login=admin, password=sekret5020');
  }
})();

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Static files (disable cache for HTML so index updates propagate immediately)
app.use(express.static('public', {
  setHeaders: (res, pathUrl) => {
    if (pathUrl.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.use('/uploads', express.static('uploads'));
app.use(session({
  store: new FileStore({ path: './data/sessions', retries: 0, ttl: 7 * 24 * 3600 }),
  secret: 'kudrovskiy-co2-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Auth helpers
const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.json({ error: 'Войди в систему' });
  next();
};
const requireAdmin = async (req, res, next) => {
  if (!req.session.userId) return res.json({ error: 'Нет доступа' });
  const user = await dbFindOne(usersDB, { _id: req.session.userId });
  if (!user || !user.is_admin) return res.json({ error: 'Только для директора' });
  next();
};

// ===================== AUTH =====================
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, display_name } = req.body;
    if (!username || !password || !display_name) return res.json({ error: 'Заполни все поля' });
    if (username.length < 3) return res.json({ error: 'Логин минимум 3 символа' });
    if (password.length < 4) return res.json({ error: 'Пароль минимум 4 символа' });
    const existing = await dbFindOne(usersDB, { username });
    if (existing) return res.json({ error: 'Такой логин уже занят' });
    const hash = bcrypt.hashSync(password, 10);
    const user = await dbInsert(usersDB, { username, password: hash, display_name, rubles: 100, is_admin: false, created_at: new Date() });
    req.session.userId = user._id;
    res.json({ success: true, message: 'Добро пожаловать! Ты получил 100 рублей на старт 🎉' });
  } catch (e) {
    if (e.errorType === 'uniqueViolated') return res.json({ error: 'Такой логин уже занят' });
    res.json({ error: 'Ошибка регистрации' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await dbFindOne(usersDB, { username });
  if (!user || !bcrypt.compareSync(password, user.password)) return res.json({ error: 'Неверный логин или пароль' });
  req.session.userId = user._id;
  res.json({ success: true, is_admin: !!user.is_admin });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ logged_in: false });
  const user = await dbFindOne(usersDB, { _id: req.session.userId });
  if (!user) return res.json({ logged_in: false });
  res.json({ logged_in: true, id: user._id, username: user.username, display_name: user.display_name, rubles: user.rubles, is_admin: !!user.is_admin });
});

// ===================== STUDENTS =====================
// Helper to enrich a student doc with id + user names
async function enrichStudent(s) {
  const seller = await dbFindOne(usersDB, { _id: s.seller_id });
  const buyer = s.buyer_id ? await dbFindOne(usersDB, { _id: s.buyer_id }) : null;
  return { ...s, id: s._id, seller_name: seller ? seller.display_name : 'Неизвестен', buyer_name: buyer ? buyer.display_name : null };
}

app.get('/api/students', async (req, res) => {
  const students = await dbFind(studentsDB, {}, { created_at: -1 });
  const enriched = await Promise.all(students.map(enrichStudent));
  res.json(enriched);
});

// Inventory: students owned by the user (bought and not relisted)
app.get('/api/my-students', requireAuth, async (req, res) => {
  const students = await dbFind(studentsDB, { buyer_id: req.session.userId, status: 'sold' }, { created_at: -1 });
  const enriched = await Promise.all(students.map(enrichStudent));
  res.json(enriched);
});

app.post('/api/students', requireAuth, upload.single('photo'), async (req, res) => {
  const { name, description, price } = req.body;
  if (!name || !price) return res.json({ error: 'Имя и цена обязательны' });
  if (isNaN(price) || price < 1) return res.json({ error: 'Цена должна быть больше 0' });
  
  // Commission check
  const seller = await dbFindOne(usersDB, { _id: req.session.userId });
  if (seller.rubles < 250) {
    return res.json({ error: 'Недостаточно средств! Комиссия за выставление — 250 ₽' });
  }

  const photo = req.file ? `/uploads/${req.file.filename}` : null;
  const student = await dbInsert(studentsDB, { name, description: description || '', price: parseInt(price), photo, seller_id: req.session.userId, status: 'available', created_at: new Date() });
  
  // Deduct commission
  await dbUpdate(usersDB, { _id: req.session.userId }, { $inc: { rubles: -250 } });

  res.json({ success: true, id: student._id });
});

app.post('/api/students/:id/buy', requireAuth, async (req, res) => {
  const student = await dbFindOne(studentsDB, { _id: req.params.id });
  if (!student) return res.json({ error: 'Ученик не найден' });
  if (student.status !== 'available') return res.json({ error: 'Ученик уже продан!' });
  if (student.seller_id === req.session.userId) return res.json({ error: 'Нельзя купить своего ученика' });
  const buyer = await dbFindOne(usersDB, { _id: req.session.userId });
  if (buyer.rubles < student.price) return res.json({ error: `Недостаточно рублей! Нужно ${student.price} ₽, у тебя ${buyer.rubles} ₽` });
  await dbUpdate(usersDB, { _id: req.session.userId }, { $inc: { rubles: -student.price } });
  await dbUpdate(usersDB, { _id: student.seller_id }, { $inc: { rubles: student.price } });
  await dbUpdate(studentsDB, { _id: req.params.id }, { $set: { status: 'sold', buyer_id: req.session.userId } });
  res.json({ success: true, message: `Ученик ${student.name} теперь твой! 🎓` });
});

app.delete('/api/students/:id', requireAuth, async (req, res) => {
  const student = await dbFindOne(studentsDB, { _id: req.params.id });
  if (!student) return res.json({ error: 'Не найден' });
  const user = await dbFindOne(usersDB, { _id: req.session.userId });
  if (student.seller_id !== req.session.userId && !user.is_admin) return res.json({ error: 'Нет прав' });
  if (student.status === 'sold') return res.json({ error: 'Уже продан' });
  await dbRemove(studentsDB, { _id: req.params.id });
  res.json({ success: true });
});

// Resell: buyer puts a purchased student back on market with new price
app.post('/api/students/:id/resell', requireAuth, async (req, res) => {
  const student = await dbFindOne(studentsDB, { _id: req.params.id });
  if (!student) return res.json({ error: 'Ученик не найден' });
  if (student.status !== 'sold') return res.json({ error: 'Ученик ещё не куплен' });
  if (student.buyer_id !== req.session.userId) return res.json({ error: 'Это не твой ученик' });
  const { price } = req.body;
  if (!price || isNaN(price) || price < 1) return res.json({ error: 'Укажи цену больше 0' });
  await dbUpdate(studentsDB, { _id: req.params.id }, { $set: {
    status: 'available',
    seller_id: req.session.userId,
    buyer_id: null,
    price: parseInt(price),
    created_at: new Date()
  }});
  res.json({ success: true, message: `Ученик ${student.name} снова выставлен на продажу!` });
});

// ===================== TAPPER =====================
const tapTimestamps = {}; // In-memory rate limit

app.post('/api/tap', requireAuth, async (req, res) => {
  const uid = req.session.userId;
  const now = Date.now();
  if (tapTimestamps[uid] && now - tapTimestamps[uid] < 80) return res.json({ error: 'Слишком быстро!' });
  tapTimestamps[uid] = now;
  const amount = Math.min(parseInt(req.body.taps) || 1, 5);
  await dbUpdate(usersDB, { _id: uid }, { $inc: { rubles: amount } });
  const user = await dbFindOne(usersDB, { _id: uid });
  res.json({ success: true, rubles: user.rubles });
});

// ===================== ADMIN =====================
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const users = await dbFind(usersDB, {}, { created_at: 1 });
  res.json(users.map(u => ({ id: u._id, username: u.username, display_name: u.display_name, rubles: u.rubles, is_admin: !!u.is_admin })));
});

app.post('/api/admin/give-rubles', requireAdmin, async (req, res) => {
  const { user_id, amount } = req.body;
  if (!user_id || !amount || isNaN(amount)) return res.json({ error: 'Укажи пользователя и сумму' });
  const user = await dbFindOne(usersDB, { _id: user_id });
  if (!user) return res.json({ error: 'Пользователь не найден' });
  await dbUpdate(usersDB, { _id: user_id }, { $inc: { rubles: parseInt(amount) } });
  const updated = await dbFindOne(usersDB, { _id: user_id });
  res.json({ success: true, message: `Выдано ${amount} ₽ пользователю ${user.display_name}`, new_balance: updated.rubles });
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n🏫 Авито ЦО-2 запущен: http://localhost:${PORT}`);
  console.log(`👨‍💼 Администратор: login=admin, password=sekret5020\n`);
});
