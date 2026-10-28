// Checkout for paid courses (website only), the return page from Paystack, and Paystack's webhook.
import { getCourse } from '../data/courses.js';
import { config } from '../config.js';
import { AppError } from '../lib/services.js';
import { paymentsEnabled, hasPaid, startPayment, verifyPayment, validSignature, handleEvent } from '../lib/payments.js';

export default function register(r) {
  r.post('/pay/course/:id', async (ctx) => {
    if (!ctx.need()) return;
    const c = getCourse(ctx.params.id);
    if (!c || !c.fee) throw new AppError('common.not_found', 404);
    // Google Play requires its own billing for digital goods bought in the app, so checkout is web-only.
    if (ctx.inApp || !paymentsEnabled()) return ctx.redirect(`/academy/${c.id}`, 'pay.unavailable', 'error');
    if (hasPaid(ctx.user.id, 'course', c.id)) return ctx.redirect(`/academy/${c.id}/quiz`);
    const { url } = await startPayment({
      user: ctx.user, purpose: 'course', item: c.id, amountNaira: c.fee, callbackUrl: `${config.baseUrl}/pay/callback`,
    });
    ctx.res.redirect(url);
  });

  // Paystack sends the person back here with ?reference=… — we ask Paystack for the real result.
  r.get('/pay/callback', async (ctx) => {
    if (!ctx.need()) return;
    let p;
    try {
      p = await verifyPayment(ctx.query.reference || ctx.query.trxref);
    } catch (e) {
      if (e instanceof AppError) return ctx.redirect('/academy', e.key, 'error');
      throw e;
    }
    if (p.user_id !== ctx.user.id) throw new AppError('common.forbidden', 403);
    const back = `/academy/${p.item}`;
    if (p.status === 'success') return ctx.redirect(`${back}/quiz`, 'pay.success');
    if (p.status === 'pending') return ctx.redirect(back, 'pay.pending', 'info');
    ctx.redirect(back, 'pay.failed', 'error');
  });

  // Server-to-server confirmation, so a payment counts even if the person closes the browser before returning.
  r.post('/pay/webhook', (ctx) => {
    if (!paymentsEnabled()) return ctx.res.text('disabled', 404);
    if (!validSignature(ctx.body.raw, ctx.req.headers['x-paystack-signature'])) {
      ctx.log.warn('paystack webhook with bad signature', { ip: ctx.ip });
      return ctx.res.text('bad signature', 401);
    }
    const result = handleEvent(ctx.body);
    ctx.log.info('paystack webhook', { event: ctx.body.event, reference: ctx.body.data?.reference, result });
    ctx.res.text('ok');
  });
}
