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
 *   • signing up takes a code, and the code is what creates the account;
 *   • signing up queues a welcome email;
 *   • a "confirm this booking" style notification lands in the outbox;
 *   • `forgot-password` queues a six-digit code (read back from the outbox, the
 *     only place it exists in the clear — the table itself stores a digest), and
 *     refuses to send a second one within the minute;
 *   • a wrong code is refused and says how many tries are left;
 *   • the right code sets the password, kills the code, and queues the
 *     "password changed" receipt;
 *   • closing an account takes a second code, and leaves the row intact but
 *     unreachable (no login, no lookup, history still reads).
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
ok('and how mail is drained', typeof health.body?.mail?.drain === 'string', JSON.stringify(health.body?.mail));

console.log('\n— an account cannot be created without the emailed code —');
const phone = '98' + String(Date.now()).slice(-8);
const details = { name: 'Sprint Tester', email, phone, password, role: 'player', defaultCity: 'Kathmandu' };

const noCode = await call('/api/auth/signup', details);
ok('signup without a code is refused', noCode.status === 400 && noCode.body?.needsCode === true,
  noCode.status + ' ' + JSON.stringify(noCode.body).slice(0, 140));

const bogusCode = await call('/api/auth/signup', { ...details, code: '000000' });
ok('signup with a made-up code is refused', bogusCode.status === 401, bogusCode.status + ' ' + JSON.stringify(bogusCode.body).slice(0, 140));

let nobody = await db.query('select id from users where email=?', [email]);
ok('and no account was created either time', (nobody.rows?.length ?? 0) === 0, JSON.stringify(nobody.rows));

const askCode = await call('/api/auth/signup/code', { email, name: details.name });
ok('the code is sent', askCode.status === 200, askCode.status + ' ' + JSON.stringify(askCode.body).slice(0, 140));

const again = await call('/api/auth/signup/code', { email });
ok('asking twice in a row is rate limited', again.status === 429, again.status + ' ' + JSON.stringify(again.body).slice(0, 120));

const taken = await call('/api/auth/signup/code', { email: 'futsalmate67@gmail.com' });
ok('an existing address is told to log in instead', taken.status === 409 || taken.status === 429,
  taken.status + ' ' + JSON.stringify(taken.body).slice(0, 140));

// The code is only ever in the clear inside the email we are about to send.
const signupMail = await db.query(
  "select payload from email_outbox where to_email=? and type='signup' order by id desc limit 1",
  [email],
);
const signupPayload = typeof signupMail.rows?.[0]?.payload === 'string'
  ? JSON.parse(signupMail.rows[0].payload)
  : signupMail.rows?.[0]?.payload;
const signupCode = String(signupPayload?.code ?? '');
ok('the signup email carries a six-digit code', /^\d{6}$/.test(signupCode), signupCode);
ok('and the stored row is only a digest', (await db.query(
  "select code_hash from email_codes where email=? and purpose='signup' order by id desc limit 1",
  [email],
)).rows?.[0]?.code_hash !== signupCode, 'hash equals code');

console.log('\n— signing up queues the welcome email —');
const signup = await call('/api/auth/signup', { ...details, code: signupCode });
const userId = signup.body?.user?.id;
ok('account created with the code', signup.status === 201 && !!userId, signup.status + ' ' + JSON.stringify(signup.body).slice(0, 160));
ok('the code cannot be spent twice', (await call('/api/auth/signup', { ...details, phone: '98' + String(Date.now()).slice(-8) + '1', code: signupCode })).status !== 201,
  'a second signup with the same code');

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

/*
 * The regression that hurt: the drain used to run inside every request, so a
 * slow SMTP conversation blocked the single-threaded `php artisan serve` and
 * every polling screen timed out. With a separate drain process the API must
 * stay quick *while* mail is in flight — which is right now, with a couple of
 * messages just queued for this account.
 */
console.log('\n— the API stays quick while mail is in flight —');
const queued = (await db.query(
  'select count(*) as n from email_outbox where to_email=? and status=?',
  [email, 'pending'],
)).rows?.[0]?.n ?? 0;

let slowest = 0;
for (let i = 0; i < 5; i++) {
  const started = Date.now();
  const r = await call('/api/health');
  slowest = Math.max(slowest, Date.now() - started);
  if (r.status !== 200) break;
}
ok('five polls, none slower than a second', slowest < 1000, `slowest ${slowest}ms with ${queued} still queued`);

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

console.log('\n— closing an account takes a code, and the row survives —');
const noProof = await call(`/api/users/${userId}`, {}, 'DELETE');
ok('deleting without a code is refused', noProof.status === 400 && noProof.body?.needsCode === true,
  noProof.status + ' ' + JSON.stringify(noProof.body).slice(0, 140));

// Put the account's email preference back on: a closed account must still be
// able to receive the code that closes it.
await call(`/api/users/${userId}`, { emailNotifications: true }, 'PATCH');

const askDelete = await call(`/api/users/${userId}/delete-code`, {});
ok('a deletion code is sent', askDelete.status === 200 && String(askDelete.body?.email ?? '').includes('•••'),
  askDelete.status + ' ' + JSON.stringify(askDelete.body).slice(0, 140));

const deleteMail = await db.query(
  "select payload from email_outbox where to_email=? and type='account' order by id desc limit 1",
  [email],
);
const deletePayload = typeof deleteMail.rows?.[0]?.payload === 'string'
  ? JSON.parse(deleteMail.rows[0].payload)
  : deleteMail.rows?.[0]?.payload;
const deleteCode = String(deletePayload?.code ?? '');
ok('the deletion email carries a six-digit code', /^\d{6}$/.test(deleteCode), deleteCode);

const badDelete = await call(`/api/users/${userId}`, { code: '000000' }, 'DELETE');
ok('a wrong deletion code is refused', badDelete.status === 401, badDelete.status + ' ' + JSON.stringify(badDelete.body).slice(0, 120));
ok('and the account is still usable', (await call('/api/auth/login', { email, password: newPassword })).status === 200, 'login after a failed delete');

const deleted = await call(`/api/users/${userId}`, { code: deleteCode }, 'DELETE');
ok('the right code closes the account', deleted.status === 200 && deleted.body?.closed === true,
  deleted.status + ' ' + JSON.stringify(deleted.body).slice(0, 140));

const row = await db.query('select name, email, phone, deleted_at, password_hash from users where id=?', [userId]);
const closed = row.rows?.[0];
ok('the row survives, so bookings and payments keep reading', !!closed, JSON.stringify(row.rows));
ok('the identity is scrubbed', closed?.email?.includes('@deleted.futsal.invalid') && closed?.phone === '' && closed?.password_hash === '',
  JSON.stringify(closed));
ok('and it is marked deleted', !!closed?.deleted_at, String(closed?.deleted_at));

const loginAfter = await call('/api/auth/login', { email, password: newPassword });
ok('a closed account cannot log in', loginAfter.status === 404, loginAfter.status + ' ' + JSON.stringify(loginAfter.body).slice(0, 120));

const lookupAfter = await call(`/api/users/${userId}`);
ok('and is not findable by id', lookupAfter.status === 404 || !lookupAfter.body?.user, lookupAfter.status);

const reuseEmail = await call('/api/auth/signup/code', { email });
ok('the address is free again', reuseEmail.status === 200, reuseEmail.status + ' ' + JSON.stringify(reuseEmail.body).slice(0, 140));
await db.query('delete from email_codes where email=?', [email]);

console.log('\n— tidy up —');
await db.query('delete from email_outbox where to_email=?', [email]);
await db.query('delete from notifications where user_id=?', [userId]);
await db.query('delete from users where id=?', [userId]);
console.log('  cleaned up the test account, its codes and its queued mail');

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
