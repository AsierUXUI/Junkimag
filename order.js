// Order form popup, shared by the zine pages and the catalog.
// JunkiOrder.open('issue-01') (slug or title) opens it with that issue picked.
//
// Nothing is paid on the site: the order is emailed to the collective, the
// buyer gets an automatic reply, and payment is arranged by hand.

(function () {
  // ── Settings: change these ───────────────────────────────────────────
  var POSTAGE = 2.5;   // placeholder flat postage per order, in euros. 0 = free.
  var PAYMENT_METHODS = ['Bizum', 'Bank transfer', 'PayPal'];
  var PICKUP_NOTE = "We'll email you to arrange a time and place.";   // placeholder
  var MAX_QTY = 10;
  var CONTACT_EMAIL = 'junkimagazine@comic.com';   // shown if an order fails to send

  // ── EmailJS setup ────────────────────────────────────────────────────
  // 1. Create a free account at https://emailjs.com
  // 2. Add an Email Service (the collective's shared Gmail, for example) → copy the Service ID
  // 3. Create TWO email templates → copy their Template IDs
  //    Template 1, sent TO THE COLLECTIVE.
  //      Subject: New order: {{issue}} × {{quantity}} from {{customer_name}}
  //      Body can use: {{customer_name}} {{customer_email}} {{issue}} {{quantity}}
  //      {{delivery}} {{customer_address}} {{payment_method}} {{notes}}
  //      {{order_summary}} {{total}}
  //    Template 2, automatic reply TO THE BUYER. Set its "To Email" to {{customer_email}}.
  //      Thank them, repeat {{order_summary}}, then write the payment details for
  //      each method you accept (Bizum number, IBAN, PayPal address) and ask them
  //      to put their name in the payment note.
  // 4. Account → API Keys → copy your Public Key
  // Then replace the four placeholder strings below.
  var EMAILJS_PUBLIC_KEY = 'YOUR_PUBLIC_KEY';
  var EMAILJS_SERVICE_ID = 'YOUR_SERVICE_ID';
  var ORDER_TEMPLATE_ID  = 'YOUR_ORDER_TEMPLATE_ID';
  var REPLY_TEMPLATE_ID  = 'YOUR_REPLY_TEMPLATE_ID';
  // ─────────────────────────────────────────────────────────────────────

  var ZINES = window.JUNKI_ZINES || [];
  var price = function (z) { var n = parseFloat(String(z && z.price || '').replace(/[^0-9.,]/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  var money = function (n) { return '€' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, ''); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var css = `
    .order-overlay { position: fixed; inset: 0; z-index: 1000; display: none; align-items: flex-start; justify-content: center;
      padding: 32px 16px; overflow-y: auto; background: rgba(17,17,17,.45); overscroll-behavior: contain; }
    .order-overlay.is-open { display: flex; }
    .order-modal { position: relative; width: 100%; max-width: 540px; background: #F2F0EB; color: #111;
      border: 1px solid #111; padding: 30px 28px 26px; font-family: 'Inter', system-ui, sans-serif; font-weight: 500;
      letter-spacing: -0.02em; font-size: 15px; animation: order-in .45s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes order-in { from { transform: translateY(16px); opacity: 0; } }
    .order-modal h2 { font-family: 'Bricolage Grotesque', 'Arial Black', sans-serif; font-weight: 800; text-transform: uppercase;
      font-size: 32px; line-height: 1; letter-spacing: -0.04em; margin: 0 0 8px; }
    .order-modal .sub { margin: 0 0 8px; color: rgba(17,17,17,.62); font-size: 14px; }
    .order-modal fieldset { border: 0; border-top: 1px solid rgba(17,17,17,.18); margin: 18px 0 0; padding: 14px 0 0; }
    .order-modal legend, .order-modal label.lbl { font-family: 'Space Mono', ui-monospace, monospace; font-size: 11px;
      letter-spacing: .2em; text-transform: uppercase; padding: 0; }
    .order-modal legend { float: left; width: 100%; margin-bottom: 10px; }
    .order-modal label.lbl { display: block; margin: 12px 0 6px; }
    .order-modal .opt { font-weight: 400; letter-spacing: .1em; color: rgba(17,17,17,.5); }
    .order-modal input[type=text], .order-modal input[type=email], .order-modal input[type=number], .order-modal select, .order-modal textarea {
      width: 100%; box-sizing: border-box; border: 1px solid #111; border-radius: 0; background: #fff; padding: 10px 12px;
      font: inherit; color: #111; outline: none; appearance: none; -webkit-appearance: none; }
    .order-modal select { background-image: linear-gradient(45deg, transparent 50%, #111 50%), linear-gradient(135deg, #111 50%, transparent 50%);
      background-position: calc(100% - 18px) 50%, calc(100% - 13px) 50%; background-size: 5px 5px; background-repeat: no-repeat; padding-right: 34px; }
    .order-modal :is(input, select, textarea):focus-visible { box-shadow: 0 0 0 3px #FF48B0; }
    .order-modal textarea { min-height: 76px; resize: vertical; }
    .order-modal .row { display: grid; grid-template-columns: 1fr 120px; gap: 12px; clear: both; }
    .order-modal .row > div > label.lbl { margin-top: 0; }
    .order-modal .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; clear: both; }
    .order-modal .choice { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px;
      border: 1px solid rgba(17,17,17,.35); background: #fff; cursor: pointer; transition: border-color .2s, box-shadow .2s; }
    .order-modal .choice input { position: absolute; opacity: 0; pointer-events: none; }
    .order-modal .choice small { color: rgba(17,17,17,.55); font-size: 12px; }
    .order-modal .choice:has(input:checked) { border-color: #111; box-shadow: inset 0 0 0 1px #111; }
    .order-modal .choice:has(input:checked)::after { content: ''; position: absolute; top: 10px; right: 10px; width: 7px; height: 7px;
      background: #FF48B0; transform: rotate(45deg); }
    .order-modal .choice:has(input:focus-visible) { box-shadow: 0 0 0 3px #FF48B0; }
    .order-modal .note { margin: 10px 0 0; font-size: 13px; color: rgba(17,17,17,.62); }
    .order-modal [hidden] { display: none !important; }
    .order-summary { margin-top: 20px; padding: 14px 0 0; border-top: 1px solid #111; font-size: 14px; }
    .order-summary div { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
    .order-summary .total { font-family: 'Bricolage Grotesque', 'Arial Black', sans-serif; font-weight: 800; font-size: 22px;
      text-transform: uppercase; letter-spacing: -0.03em; padding-top: 8px; }
    .order-modal button[type=submit] { width: 100%; margin-top: 18px; padding: 15px; border: 1px solid #111; border-radius: 500px;
      background: #111; color: #F2F0EB; font-family: 'Space Mono', ui-monospace, monospace; font-size: 12px; letter-spacing: .2em;
      text-transform: uppercase; cursor: pointer; transition: background .25s, color .25s; }
    .order-modal button[type=submit]:hover:not(:disabled) { background: #FF48B0; color: #111; }
    .order-modal button[type=submit]:disabled { opacity: .5; cursor: not-allowed; }
    .order-modal .fine { margin: 10px 0 0; text-align: center; font-size: 12px; color: rgba(17,17,17,.55); }
    .order-close { position: absolute; top: 12px; right: 14px; border: 0; background: none; font-size: 22px; line-height: 1;
      cursor: pointer; color: #111; padding: 4px; }
    .order-status { margin-top: 14px; padding: 12px; border: 1px solid #111; font-size: 14px; background: #fde7ef; }
    .order-done h2 { margin-bottom: 14px; }
    .order-done p { margin: 0 0 10px; }
    .order-done .order-summary { margin-bottom: 20px; }
    .order-done button { width: 100%; padding: 14px; border: 1px solid #111; border-radius: 500px; background: transparent; cursor: pointer;
      font-family: 'Space Mono', ui-monospace, monospace; font-size: 12px; letter-spacing: .2em; text-transform: uppercase; }
    @media (max-width: 480px) { .order-modal { padding: 26px 18px 22px; } .order-modal .row { grid-template-columns: 1fr 96px; } }
  `;

  function optionsHTML() {
    return ZINES.map(function (z) { return '<option value="' + esc(z.slug) + '">' + esc(z.title) + (z.price ? ' · ' + esc(z.price) : '') + '</option>'; }).join('');
  }
  function radios(name, items) {
    return items.map(function (it, i) {
      return '<label class="choice"><input type="radio" name="' + name + '" value="' + esc(it.value) + '"' + (i === 0 ? ' checked' : '') + ' required>' +
        '<span>' + esc(it.label) + '</span>' + (it.hint ? '<small>' + esc(it.hint) + '</small>' : '') + '</label>';
    }).join('');
  }

  var html = `
    <div class="order-modal" role="dialog" aria-modal="true" aria-labelledby="order-title">
      <button class="order-close" type="button" aria-label="Close">✕</button>
      <div class="order-step">
        <h2 id="order-title">Order a copy</h2>
        <p class="sub">Nothing to pay yet. Send your order and we'll email you how to pay.</p>
        <form novalidate>
          <fieldset>
            <legend>Your zine</legend>
            <div class="row">
              <div><label class="lbl" for="order-issue">Issue</label><select id="order-issue" name="issue_slug" required>${optionsHTML()}</select></div>
              <div><label class="lbl" for="order-qty">Copies</label><input id="order-qty" name="quantity" type="number" inputmode="numeric" min="1" max="${MAX_QTY}" value="1" required></div>
            </div>
          </fieldset>

          <fieldset>
            <legend>Delivery</legend>
            <div class="choices">${radios('delivery', [
              { value: 'Post', label: 'Post', hint: POSTAGE ? '+ ' + money(POSTAGE) + ' postage' : 'Free postage' },
              { value: 'Pick up', label: 'Pick up', hint: 'Free' },
            ])}</div>
            <div class="when-post">
              <label class="lbl" for="order-address">Delivery address</label>
              <textarea id="order-address" name="customer_address" placeholder="Street, number, postcode, city, country" autocomplete="street-address"></textarea>
            </div>
            <p class="note when-pickup" hidden>${esc(PICKUP_NOTE)}</p>
          </fieldset>

          <fieldset>
            <legend>How you'd like to pay</legend>
            <div class="choices">${radios('payment_method', PAYMENT_METHODS.map(function (m) { return { value: m, label: m }; }))}</div>
          </fieldset>

          <fieldset>
            <legend>Your details</legend>
            <label class="lbl" for="order-name" style="margin-top:0;clear:both">Name</label>
            <input id="order-name" name="customer_name" type="text" required autocomplete="name">
            <label class="lbl" for="order-email">Email</label>
            <input id="order-email" name="customer_email" type="email" required autocomplete="email" placeholder="you@example.com">
            <label class="lbl" for="order-notes">Notes <span class="opt">(optional)</span></label>
            <textarea id="order-notes" name="notes" placeholder="Anything we should know?"></textarea>
          </fieldset>

          <div class="order-summary" aria-live="polite"></div>
          <button type="submit">Send order</button>
          <p class="fine">We'll reply by email with payment details.</p>
          <div class="order-status" role="alert" hidden></div>
        </form>
      </div>
      <div class="order-done" hidden>
        <h2>Thank you!</h2>
        <p class="done-msg"></p>
        <div class="order-summary"></div>
        <button type="button" class="done-close">Close</button>
      </div>
    </div>`;

  var overlay, form, status, submit, stepEl, doneEl, lastFocus;

  function build() {
    if (overlay) return;
    var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    overlay = document.createElement('div'); overlay.className = 'order-overlay'; overlay.innerHTML = html;
    // keep wheel/touch scrolling inside the popup (smooth-scroll pages would otherwise take it)
    overlay.setAttribute('data-lenis-prevent', '');
    document.body.appendChild(overlay);
    form = overlay.querySelector('form'); status = overlay.querySelector('.order-status'); submit = form.querySelector('button[type=submit]');
    stepEl = overlay.querySelector('.order-step'); doneEl = overlay.querySelector('.order-done');
    overlay.querySelector('.order-close').addEventListener('click', close);
    overlay.querySelector('.done-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('is-open')) close(); });
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', send);
    if (window.emailjs) emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
  }

  function read() {
    var z = ZINES.find(function (x) { return x.slug === form.issue_slug.value; }) || ZINES[0];
    var qty = Math.max(1, Math.min(MAX_QTY, parseInt(form.quantity.value, 10) || 1));
    var delivery = (form.querySelector('input[name=delivery]:checked') || {}).value || 'Post';
    var postage = delivery === 'Post' ? POSTAGE : 0;
    var subtotal = price(z) * qty;
    return { zine: z, qty: qty, delivery: delivery, postage: postage, subtotal: subtotal, total: subtotal + postage,
      payment: (form.querySelector('input[name=payment_method]:checked') || {}).value || '' };
  }

  function summaryHTML(o) {
    return '<div><span>' + o.qty + ' × ' + esc(o.zine.title) + '</span><span>' + money(o.subtotal) + '</span></div>' +
      '<div><span>' + (o.delivery === 'Post' ? 'Postage' : 'Pick up') + '</span><span>' + (o.postage ? money(o.postage) : 'Free') + '</span></div>' +
      '<div class="total"><span>Total</span><span>' + money(o.total) + '</span></div>';
  }

  function update() {
    var o = read();
    var post = o.delivery === 'Post';
    form.querySelector('.when-post').hidden = !post;
    form.querySelector('.when-pickup').hidden = post;
    form.customer_address.required = post;
    form.querySelector('.order-summary').innerHTML = summaryHTML(o);
  }

  function open(issue) {
    build();
    lastFocus = document.activeElement;
    form.reset();
    var z = ZINES.find(function (x) { return x.slug === issue || x.title === issue; }) || ZINES[0];
    if (z) form.issue_slug.value = z.slug;
    status.hidden = true; stepEl.hidden = false; doneEl.hidden = true;
    update();
    overlay.classList.add('is-open');
    overlay.scrollTop = 0;
    document.documentElement.style.overflow = 'hidden';
    form.quantity.focus();
  }

  function close() {
    overlay.classList.remove('is-open');
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  async function send(e) {
    e.preventDefault();
    update();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    var o = read();
    var summary = o.qty + ' × ' + o.zine.title + ' (' + money(o.subtotal) + ')' +
      (o.delivery === 'Post' ? ', postage ' + (o.postage ? money(o.postage) : 'free') : ', pick up') + '. Total ' + money(o.total) + '.';
    var params = {
      customer_name: form.customer_name.value.trim(),
      customer_email: form.customer_email.value.trim(),
      issue: o.zine.title,
      quantity: String(o.qty),
      delivery: o.delivery,
      customer_address: o.delivery === 'Post' ? form.customer_address.value.trim() : '(pick up)',
      payment_method: o.payment,
      notes: form.notes.value.trim() || '—',
      order_summary: summary,
      total: money(o.total),
    };
    submit.disabled = true; submit.textContent = 'Sending…'; status.hidden = true;
    try {
      if (!window.emailjs) throw new Error('EmailJS did not load');
      await emailjs.send(EMAILJS_SERVICE_ID, ORDER_TEMPLATE_ID, params);   // to the collective
      await emailjs.send(EMAILJS_SERVICE_ID, REPLY_TEMPLATE_ID, params);   // automatic reply to the buyer
      doneEl.querySelector('.done-msg').textContent = 'Thanks, ' + params.customer_name.split(' ')[0] +
        '. We got your order and sent a copy to ' + params.customer_email + ' with how to pay by ' + o.payment + '.';
      doneEl.querySelector('.order-summary').innerHTML = summaryHTML(o);
      stepEl.hidden = true; doneEl.hidden = false;
      doneEl.querySelector('.done-close').focus();
    } catch (err) {
      status.hidden = false;
      status.textContent = "Sorry, the order didn't go through. Please try again, or email us at " + CONTACT_EMAIL + '.';
      console.error(err);
    } finally {
      submit.disabled = false; submit.textContent = 'Send order';
    }
  }

  window.JunkiOrder = { open: open, close: close };
})();
