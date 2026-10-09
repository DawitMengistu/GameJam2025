# Telegram bot → ATP auth contract

Your **Telegraf** bot calls the game server after the user shares their contact.

## Endpoint

`POST {APP_PUBLIC_URL}/api/auth/telegram`

Headers:

- `Content-Type: application/json`
- `X-Bot-Secret: {BOT_API_SECRET}` (same value as server env)

Body (JSON):

```json
{
  "telegram_id": 123456789,
  "phone_number": "+15551234567",
  "first_name": "Alex",
  "last_name": "Kim",
  "username": "alexkim"
}
```

You can also nest Telegram user fields under `"user": { "id", "first_name", ... }`.

## Response

```json
{
  "ok": true,
  "user_id": "uuid",
  "url": "https://your-app.com/auth?token=...",
  "expires_in_seconds": 900
}
```

Send `url` to the user in Telegram (button or message). Link is **one-time**, ~15 minutes.

## User flow

1. User taps **Share contact** in the bot (inline keyboard).
2. Bot POSTs to `/api/auth/telegram`.
3. Bot replies with “Open ATP” → `url`.
4. Browser opens `/auth?token=...` → server sets **30-day** HttpOnly cookie → redirect to `/`.

## Telegraf sketch

```js
bot.on('contact', async (ctx) => {
  const c = ctx.message.contact;
  if (c.user_id !== ctx.from.id) {
    return ctx.reply('Please share your own contact.');
  }
  const res = await fetch(`${APP_URL}/api/auth/telegram`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bot-Secret': process.env.BOT_API_SECRET,
    },
    body: JSON.stringify({
      telegram_id: c.user_id,
      phone_number: c.phone_number,
      first_name: c.first_name,
      last_name: c.last_name,
      username: ctx.from.username,
    }),
  });
  const data = await res.json();
  if (!data.url) return ctx.reply('Could not sign in. Try again later.');
  await ctx.reply('Tap to play ATP:', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Open ATP', url: data.url }]],
    },
  });
});
```

## Session check (web / future socket)

- `GET /api/me` with cookie → current user + ELO (+ `ai_elo`)
- `GET /api/history` → recent games for the signed-in user
- `GET /api/config` → bot login URL, AI Elo, etc.
- `POST /api/auth/logout` → clears session

## Elo

- Players start at **100**.
- **Standard Elo**, K=32 (expected score `1/(1+10^((Rb-Ra)/400))`).
- **PvP** updates both ratings after a win.
- **vs AI** is recorded; human Elo does **not** change. AI display rating defaults to **1000** (`AI_DEFAULT_ELO`).

## Env (server)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon Postgres connection string |
| `BOT_API_SECRET` | Shared secret with Telegraf bot |
| `TELEGRAM_BOT_TOKEN` | BotFather token (for your Telegraf process) |
| `TELEGRAM_BOT_USERNAME` | Bot username without `@` (lobby login button) |
| `AI_DEFAULT_ELO` | AI rating shown in UI (default 1200) |
| `APP_PUBLIC_URL` | Public URL for magic links (e.g. `http://localhost:3000`) |

Neon project: **ATP** (`silent-sunset-77534428`), database **`atp`**.
