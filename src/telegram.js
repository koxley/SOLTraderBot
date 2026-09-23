import { jsonRequest } from './providers.js';
import { UserError, format } from './config.js';

export const HELP = `SOL TRADER — automatic SOL/USDC trading\n\n/start — start automatic trading\n/stop — stop trading, keep position\n/close — stop and close the bot's open position\n/app — open the Mini App\n/status — strategy and limits\n/balance — balances\n/history — recent trades\n/reconcile — check an unsettled transaction\n/help — show commands\n\nStop does not sell. Close Open Positions sells only USDC bought by this bot. A submitted transaction cannot be cancelled. Strategy exits work only while this process is online and trading is running.`;

export class Telegram {
  constructor(cfg, engine, publicUrl) { Object.assign(this, { cfg, engine, publicUrl }); this.stopped = false; }
  api(method, body, timeout) {
    return jsonRequest(`https://api.telegram.org/bot${this.cfg.token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, timeout).then(result => { if (!result.ok) throw new Error('Telegram API rejected request.'); return result.result; });
  }
  send(text, extra = {}) { return this.api('sendMessage', { chat_id: this.cfg.owner, text: text.slice(0, 4000), ...extra }); }
  async setup() {
    const hook = await this.api('getWebhookInfo', {});
    if (hook.url) throw new Error('This bot has a webhook. Remove it before using polling.');
    const optional = async action => { try { await action(); } catch { console.warn('Telegram profile/menu update or startup notification deferred. Bot commands remain available.'); } };
    await optional(() => this.api('setMyName', { name: 'SOL TRADER' }));
    await optional(() => this.api('setMyCommands', { commands: [
      ['app', 'Open trading dashboard'], ['start', 'Start automatic trading'], ['stop', 'Stop trading; keep position'],
      ['close', 'Stop and sell the bot position'], ['status', 'Strategy status'], ['balance', 'Wallet balances'],
      ['history', 'Recent trades'], ['reconcile', 'Check unsettled trades'], ['help', 'Help'],
    ].map(([command, description]) => ({ command, description })) }));
    if (this.publicUrl) await optional(() => this.api('setChatMenuButton', { chat_id: this.cfg.owner,
      menu_button: { type: 'web_app', text: 'Open SOL TRADER', web_app: { url: this.publicUrl } } }));
    await optional(() => this.send(`SOL TRADER is online in ${this.cfg.mode.toUpperCase()} mode and STOPPED. Use /app or /start.`, {
      reply_markup: { keyboard: [[{ text: 'Start' }, { text: 'Stop' }], [{ text: 'Close Open Positions' }],
        ...(this.publicUrl ? [[{ text: 'Open SOL TRADER', web_app: { url: this.publicUrl } }]] : [])], resize_keyboard: true },
    }));
  }
  async handle(update) {
    const msg = update.message;
    if (!msg || msg.chat?.type !== 'private' || String(msg.from?.id) !== this.cfg.owner || String(msg.chat.id) !== this.cfg.owner) return;
    // Ignore old control messages after a long outage.
    if (Date.now() / 1000 - msg.date > 120) return;
    const command = ({ Start: '/start', Stop: '/stop', 'Close Open Positions': '/close' })[msg.text] || msg.text?.split(/\s/)[0].split('@')[0];
    try {
      let response;
      switch (command) {
        case '/start': this.engine.start(); response = `Automatic ${this.cfg.mode.toUpperCase()} trading started. /status shows warm-up progress. /stop halts trading; /close also sells the bot position.`; break;
        case '/stop': this.engine.stop(); response = 'Stopped. Position kept. Any already submitted transaction may still complete.'; break;
        case '/close': this.engine.requestClose(); response = 'Strategy stopped. Closing the bot position as soon as any current operation settles.'; break;
        case '/status': response = this.engine.status(); break;
        case '/balance': { const b = await this.engine.balances(); response = `${this.cfg.mode.toUpperCase()} balances\n${format(b.SOL, 9)} SOL\n${format(b[this.cfg.pair === 'DOGE_SOL' ? 'DOGE' : 'USDC'], this.cfg.pair === 'DOGE_SOL' ? this.cfg.tokens.DOGE.decimals : 6)} ${this.cfg.pair === 'DOGE_SOL' ? 'DOGE' : 'USDC'}${this.engine.wallet ? `\n${this.engine.wallet.address}` : ''}`; break; }
        case '/history': response = this.engine.store.orders().filter(o => o.mode === this.cfg.mode).slice(0, 10)
          .map(o => `${new Date(o.time).toISOString()} ${o.side} ${o.status}\n${o.signature || o.id}`).join('\n\n') || 'No trades yet.'; break;
        case '/reconcile': response = await this.engine.reconcile(); break;
        case '/app':
          if (this.publicUrl) return this.send('Open SOL TRADER', { reply_markup: { inline_keyboard: [[{ text: 'Open dashboard', web_app: { url: this.publicUrl } }]] } });
          response = 'Set PUBLIC_APP_URL to your HTTPS deployment URL and restart to enable the Mini App.'; break;
        default: response = HELP;
      }
      await this.send(response);
    } catch (error) { await this.send(error instanceof UserError ? error.message : 'Operation failed. Check service connectivity and /status.'); }
  }
  async poll() {
    while (!this.stopped) {
      try {
        const updates = await this.api('getUpdates', { offset: this.engine.store.get('offset') || 0, timeout: 25, allowed_updates: ['message'] }, 35000);
        for (const update of updates) {
          // At-most-once control delivery: persist before executing a control command.
          this.engine.store.set('offset', update.update_id + 1);
          await this.handle(update);
        }
      } catch { if (!this.stopped) await new Promise(resolve => setTimeout(resolve, 3000)); }
    }
  }
}
