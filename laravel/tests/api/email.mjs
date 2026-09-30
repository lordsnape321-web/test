/**
 * Live suite: the email system and the email-code password reset.
 *
 *   cd laravel && php artisan serve
 *   cd laravel/tests/api && npm install
 *   BASE_URL=http://127.0.0.1:8000 node email.mjs
 *
 * What it proves, against a real server and a real database:
 *
 *   • `/api/health` reports whether mail is configured and how much is queued;
 *   • signing up queues a welcome email;
 *   • a "confirm this booking" style notification lands in the outbox;
 *   • `forgot-password` queues a six-digit code (read back from the outbox, the
 *     only place it exists in the clear — the table itself stores a digest), and
 *     refuses to send a second one within the minute;
 *   • a wrong code is refused and says how many tries are left;
 *   • the right code sets the password, kills the code, and queues the
 *     "password changed" receipt.
 *
 * It needs the database (for `email_outbox`) — like `ledger.mjs`, it speaks
 * MySQL through `mysql.mjs`, reading the credentials from `laravel/.env`.
 */

import { Client } from './mysql.mjs';

const B = process.env.BASE_URL || 'http://127.0.0.1:8000';
const db = new Client();

let pass = 0;
let fail = 0;
const ok = (n, c, e = '') => {
  c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (e ? '  → ' + e : '')));
};
const call = async (p, body, method) => {
  const r = await fetch(B + p, body
    ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: method || 'GET' });
  let b = null;
  try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
};

// A fresh address every run, so the suite is repeatable against a live database.
const email = `sprint-${Date.now()}@futsal.test`;
const password = 'futsal123';
const newPassword = 'turfburn456';

console.log('\n— health reports the mail setup —');
const health = await call('/api/health');
ok('health answers', health.status === 200, health.status + ' ' + JSON.stringify(health.body).slice(0, 120));
ok('it describes the mailer', typeof health.body?.mail?.driver === 'string', JSON.stringify(health.body?.mail));
ok('and says whether mail is configured', typeof health.body?.mail?.configured === 'boolean', JSON.stringify(health.body?.mail));

console.log('\n— signing up queues the welcome email —');
const signup = await call('/api/auth/signup', {
  name: 'Sprint Tester',
  email,
  phone: '98' + String(Date.now()).slice(-8),
  password,
  role: 'player',
  defaultCity: 'Kathmandu',
});
const userId = signup.body?.user?.id;
ok('account created', signup.status === 201 && !!userId, signup.status + ' ' + JSON.stringify(signup.body).slice(0, 160));

const welcome = await db.query(
  "select subject, status, template from email_outbox where to_email=? order by id desc limit 1",
  [email],
);
ok('a welcome email is queued for the new account', (welcome.rows?.length ?? 0) === 1, JSON.stringify(welcome.rows));
ok('with a real subject line', String(welcome.rows?.[0]?.subject ?? '').toLowerCase().includes('welcome'),
  String(welcome.rows?.[0]?.subject));

console.log('\n— booking news reaches the outbox —');
// The bell is the product's funnel for booking news; posting one through the
// API must also queue the email, not just the in-app row.
const bell = await call('/api/notifications', {
  userId,
  type: 'booking_confirmed',
  title: '✅ Booking confirmed — Sprint Arena',
  message: 'Your booking for Sat, 17 Oct at 7:00 PM was accepted by the venue.',
  link: '/bookings?focus=1',
});
ok('notification accepted', bell.status < 300, bell.status + ' ' + JSON.stringify(bell.body).slice(0, 120));

const mailed = await db.query(
  "select subject, type from email_outbox where to_email=? and type='booking_confirmed' order by id desc limit 1",
  [email],
);
ok('a booking_confirmed email is queued', (mailed.rows?.length ?? 0) === 1, JSON.stringify(mailed.rows));

console.log('\n— forgot-password sends a code —');
const first = await call('/api/auth/forgot-password', { email });
ok('the request is accepted', first.status === 200, first.status + ' ' + JSON.stringify(first.body).slice(0, 140));

const codeRow = await db.query(
  "select id, code_hash, payload from email_outbox where to_email=? and type='password' order by id desc limit 1",
  [email],
);
ok('a password email is queued', (codeRow.rows?.length ?? 0) === 1, JSON.stringify(codeRow.rows));
const payload = codeRow.rows?.[0]?.payload;
const code = typeof payload === 'string' ? JSON.parse(payload)?.code : payload?.code;
ok('it carries a six-digit code', /^[0-9]{6}$/.test(String(code)), String(code));
ok('the database keeps only a digest of it',
  String(codeRow.rows?.[0]?.code_hash ?? '').length === 64,
  String(codeRow.rows?.[0]?.code_hash).slice(0, 16));

const second = await call('/api/auth/forgot-password', { email });
ok('a second code within the minute is refused', second.status === 429,
  second.status + ' ' + JSON.stringify(second.body).slice(0, 140));

console.log('\n— an unknown address looks the same from outside —');
const stranger = await call('/api/auth/forgot-password', { email: `nobody-${Date.now()}@futsal.test` });
ok('the same 200 the real address got', stranger.status === 200, stranger.status);

console.log('\n— the wrong code is refused, the right one works —');
const wrongCode = String(code) === '000000' ? '111111' : '000000';
const wrong = await call('/api/auth/reset-with-code', { email, code: wrongCode, newPassword });
ok('the wrong code is rejected', wrong.status === 401, wrong.status + ' ' + JSON.stringify(wrong.body).slice(0, 140));
ok('and the message counts the tries left', /tries? left|expired/i.test(String(wrong.body?.error ?? '')),
  String(wrong.body?.error));

const reset = await call('/api/auth/reset-with-code', { email, code, newPassword });
ok('the right code resets the password', reset.status === 200, reset.status + ' ' + JSON.stringify(reset.body).slice(0, 140));

const receipt = await db.query(
  "select subject from email_outbox where to_email=? and subject like '%password was changed%' order by id desc limit 1",
  [email],
);
ok('a password-changed receipt is queued', (receipt.rows?.length ?? 0) === 1, JSON.stringify(receipt.rows));

const reuse = await call('/api/auth/reset-with-code', { email, code, newPassword: 'onemore789' });
ok('the spent code cannot be used twice', reuse.status === 401, reuse.status);

console.log('\n— the new password is the live one —');
const oldLogin = await call('/api/auth/login', { email, password });
ok('the old password no longer works', oldLogin.status === 401, oldLogin.status);
const newLogin = await call('/api/auth/login', { email, password: newPassword });
ok('the new password signs in', newLogin.status === 200 && !!newLogin.body?.user?.id, newLogin.status);

console.log('\n— the preference is honoured —');
const off = await call(`/api/users/${userId}`, { emailNotifications: false }, 'PATCH');
ok('booking emails can be turned off', off.body?.user?.emailNotifications === false,
  JSON.stringify(off.body?.user?.emailNotifications));
const before = await db.query('select count(*)::int as n from email_outbox where to_email=? and type=?', [email, 'booking_cancelled']);
await call('/api/notifications', {
  userId,
  type: 'booking_cancelled',
  title: '❌ Booking cancelled — Sprint Arena',
  message: 'This should stay in the app, not the inbox.',
});
const after = await db.query('select count(*)::int as n from email_outbox where to_email=? and type=?', [email, 'booking_cancelled']);
ok('a switched-off account gets no booking email',
  Number(before.rows?.[0]?.n ?? 0) === Number(after.rows?.[0]?.n ?? 0),
  `before ${before.rows?.[0]?.n} after ${after.rows?.[0]?.n}`);

const reminder = await call(`/api/users/${userId}`, { reminderMinutes: 240 }, 'PATCH');
ok('the reminder lead time is stored', reminder.body?.user?.reminderMinutes === 240,
  String(reminder.body?.user?.reminderMinutes));
const bad = await call(`/api/users/${userId}`, { reminderMinutes: 5 }, 'PATCH');
ok('an absurd lead time is refused', bad.status === 400, bad.status + ' ' + JSON.stringify(bad.body).slice(0, 120));

console.log('\n— tidy up —');
await db.query('delete from email_outbox where to_email=?', [email]);
await db.query('delete from password_reset_codes where email=?', [email]);
await db.query('delete from notifications where user_id=?', [userId]);
await db.query('delete from users where id=?', [userId]);
console.log('  cleaned up the test account, its codes and its queued mail');

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
