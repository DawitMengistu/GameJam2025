/**
 * ATP Telegram auth bot — run separately from the game server:
 *   node bot.js
 *
 * Requires TELEGRAM_BOT_TOKEN, BOT_API_SECRET, APP_PUBLIC_URL in .env
 */
import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';

const token = process.env.TELEGRAM_BOT_TOKEN;
const botSecret = process.env.BOT_API_SECRET;
const appUrl = (process.env.APP_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

if (!token) {
    console.error('Missing TELEGRAM_BOT_TOKEN in .env');
    process.exit(1);
}
if (!botSecret) {
    console.error('Missing BOT_API_SECRET in .env');
    process.exit(1);
}

const bot = new Telegraf(token);

function shareContactKeyboard() {
    return Markup.keyboard([
        Markup.button.contactRequest('Share my contact'),
    ])
        .resize()
        .oneTime();
}

bot.start(async (ctx) => {
    await ctx.reply(
        'Welcome to ATP.\n\nShare your phone contact to get a sign-in link for the game.',
        shareContactKeyboard()
    );
});

bot.command('login', async (ctx) => {
    await ctx.reply('Tap the button below to share your contact:', shareContactKeyboard());
});

bot.command('help', async (ctx) => {
    await ctx.reply(
        'Commands:\n/start — begin login\n/login — share contact again\n\nAfter you share contact, open the link to sign in to ATP.'
    );
});

bot.on('contact', async (ctx) => {
    const contact = ctx.message.contact;
    if (!contact) {
        await ctx.reply('No contact received. Try /login again.');
        return;
    }

    // Must be the user's own contact (Telegram sets user_id when sharing own phone)
    if (contact.user_id && contact.user_id !== ctx.from.id) {
        await ctx.reply('Please share *your own* contact.', {
            parse_mode: 'Markdown',
            ...shareContactKeyboard(),
        });
        return;
    }

    await ctx.reply('Creating your sign-in link…', Markup.removeKeyboard());

    try {
        const res = await fetch(`${appUrl}/api/auth/telegram`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Bot-Secret': botSecret,
            },
            body: JSON.stringify({
                telegram_id: contact.user_id || ctx.from.id,
                phone_number: contact.phone_number,
                first_name: contact.first_name || ctx.from.first_name,
                last_name: contact.last_name || ctx.from.last_name,
                username: ctx.from.username,
            }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) {
            console.error('[bot] auth API failed', res.status, data);
            await ctx.reply(
                `Could not sign you in (${data.error || res.status}). Is the game server running at ${appUrl}?`
            );
            return;
        }

        // Telegram rejects localhost / private IPs on inline URL buttons.
        const isLocal =
            /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(data.url) ||
            data.url.startsWith('http://192.168.') ||
            data.url.startsWith('http://10.');

        if (isLocal) {
            await ctx.reply(
                `Open this link on the same machine (expires in ~15 min):\n\n${data.url}\n\n(Telegram blocks localhost on buttons — copy/open the URL.)`
            );
        } else {
            await ctx.reply('Tap below to open ATP (link expires in ~15 minutes):', {
                reply_markup: {
                    inline_keyboard: [[{ text: 'Open ATP', url: data.url }]],
                },
            });
        }
    } catch (err) {
        console.error('[bot] network error', err.message);
        await ctx.reply(
            `Could not reach the game server at ${appUrl}. Start it with: node app.js`
        );
    }
});

bot.catch((err) => {
    console.error('[bot] error', err);
});

console.log('[bot] starting...');
console.log(`[bot] game API: ${appUrl}`);

async function main() {
    const me = await bot.telegram.getMe();
    bot.botInfo = me;
    console.log(`[bot] logged in as @${me.username}`);

    // Avoid hanging on deleteWebhook in some networks — clear webhook via HTTP then poll
    try {
        await fetch(
            `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`
        );
    } catch (err) {
        console.warn('[bot] deleteWebhook warn:', err.message);
    }

    bot.startPolling();
    console.log('[bot] polling - open Telegram and send /start to @' + me.username);
}

main().catch((err) => {
    console.error('[bot] failed to start:', err.message || err);
    process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
