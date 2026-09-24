# E-Learning Chat (v3) — multi-user, semester subscriptions

A Moodle-style study portal with an AI assistant, built for selling to students.

- **You (admin)** create accounts, hand out usernames and passwords, record cash payments per semester, suspend and reactivate.
- **Students** log in, keep their own course cards, chat with the AI, and every chat is saved in the course they choose.
- **Three database models only:** User, Subscription, Chat.

## Files

```
server.js             all routes (auth, chat, saved chats, admin)
lib/auth.js           password hashing (scrypt), signed cookies, login throttling
lib/access.js         semester dates and access status
lib/store.js          the 3 collections (MongoDB, or local files for development)
lib/providers.js      AI providers: Gemini, OpenRouter, Ollama, Claude, OpenAI
public/login.html     login page
public/admin.html     admin area
public/index.html     student portal
public/js/*           frontend modules
```

## The three models

| Model | Holds | Key fields |
|---|---|---|
| **User** | admins and students | username, passwordHash, name, phone, role, accountStatus, `courses[]` (their course cards), sessionVersion, usage |
| **Subscription** | one record per paid semester, and your receipt book | userId, startDate, endDate, amount, currency, paymentStatus (paid / free / void), paidAt, recordedBy, termLabel, note |
| **Chat** | one saved conversation | userId, courseId, title, model, `messages[]` (text, photos, code files), messageCount, preview |

Nothing else is stored: sessions are signed cookies, course cards live inside the User, and messages live inside the Chat.

## How access is decided (on every request)

1. `deactivated` → cannot log in.
2. `suspended` → cannot log in.
3. Last paid `endDate` + `GRACE_DAYS` is in the past → **expired**: can log in and read old chats, cannot send new messages.
4. Otherwise → **active**.

Recording a payment adds a semester starting today, or right after the current one if they pay early. Paying also lifts a suspension automatically. No background job is needed.

## First run

1. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET` and `MONGODB_URI`.
2. Start the server. On the first start it creates your admin account (if you leave `ADMIN_PASSWORD` empty, a random password is printed in the logs once).
3. Log in at `/login.html` → you land on `/admin.html`.
4. Old chats from the single-password version are moved to your admin account automatically.

## Student codes (4 digits)

Students log in with a 4-digit numeric code. The code is stored twice: as a scrypt hash
(used to check logins) and encrypted with `PIN_SECRET` (so the admin area can show it again
with **Show code**). Because a 4-digit code is easy to guess, three things protect it:

- 5 wrong tries per username and IP address in 15 minutes.
- `LOCK_AFTER_TRIES` (10) wrong tries in total locks the account for `LOCK_MINUTES` (60). The
  admin area shows a **Locked** badge and an **Unlock** button.
- Usernames are not listed anywhere public.

Set `PASSWORD_DIGITS=6` for a stronger code with the same experience.

## Keeping the AI models working

- The model list is fetched live from each provider, and Gemini models are filtered to the ones
  that actually support chat generation.
- **Test AI models** in the admin area sends one tiny message to every model and marks each as
  working or broken. Broken ones disappear from the student picker.
- If a model fails mid-request (retired, rate-limited, overloaded), the server automatically
  retries with another working model and tells the student which one answered.

## Security notes

- Passwords are hashed with scrypt and never stored or logged in plain text.
- Login cookies are HttpOnly, Secure and SameSite=Lax, signed with `SESSION_SECRET`.
- 5 wrong logins per username and IP in 15 minutes triggers a 15-minute block.
- Every chat query is filtered by owner, so changing an ID in the URL returns "not found".
- Admin routes check `role === "admin"` on the server, not just in the page.
- The admin can see how many chats and messages a student has, never their content.

## Local development

```bash
npm install
cp .env.example .env
npm start     # http://localhost:3000
```

Without `MONGODB_URI` the data is written to `./data` so you can test offline.
