// Order form popup, shared by the zine pages and the catalog.
// Call JunkiOrder.open('Issue 01') to show it for one issue.
//
// ── EmailJS setup ──────────────────────────────────────────────────────
// 1. Create a free account at https://emailjs.com
// 2. Add an Email Service (Gmail, Outlook, etc.) → copy the Service ID
// 3. Create TWO email templates → copy their Template IDs
//    Template 1, order notification sent TO YOU.
//      Suggested subject: "New order from {{customer_name}}"
//      Body: {{customer_name}}, {{customer_email}}, {{customer_address}}, {{issue}}, {{quantity}}
//    Template 2, auto-reply sent TO THE CUSTOMER.
//      Set its "To Email" to {{customer_email}}; greet {{customer_name}},
//      list the order, then add your payment details.
// 4. Account → API Keys → copy your Public Key
// Then replace the four placeholder strings below.
(function () {
  var EMAILJS_PUBLIC_KEY = 'YOUR_PUBLIC_KEY';
  var EMAILJS_SERVICE_ID = 'YOUR_SERVICE_ID';
  var ORDER_TEMPLATE_ID  = 'YOUR_ORDER_TEMPLATE_ID';
  var REPLY_TEMPLATE_ID  = 'YOUR_REPLY_TEMPLATE_ID';

  var css = `
    .order-overlay { position: fixed; inset: 0; z-index: 1000; display: none; align-items: flex-start; justify-content: center;
      padding: 40px 16px; overflow-y: auto; background: rgba(17,17,17,.45); }
    .order-overlay.is-open { display: flex; }
    .order-modal { position: relative; width: 100%; max-width: 520px; background: #F2F0EB; color: #111;
      border: 1px solid #111; padding: 32px 28px; font-family: 'Inter', system-ui, sans-serif; font-weight: 500;
      letter-spacing: -0.02em; animation: order-in .45s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes order-in { from { transform: translateY(16px); opacity: 0; } }
    .order-modal h2 { font-family: 'Bricolage Grotesque', 'Arial Black', sans-serif; font-weight: 800; text-transform: uppercase;
      font-size: 32px; line-height: 1; letter-spacing: -0.04em; margin: 0 0 8px; }
    .order-modal .sub { margin: 0 0 20px; color: rgba(17,17,17,.6); font-size: 14px; }
    .order-modal label { display: block; margin: 16px 0 6px; font-family: 'Space Mono', ui-monospace, monospace;
      font-size: 11px; letter-spacing: .2em; text-transform: uppercase; }
    .order-modal input, .order-modal textarea { width: 100%; box-sizing: border-box; border: 1px solid #111; border-radius: 0;
      background: #fff; padding: 10px 12px; font: inherit; font-size: 15px; color: #111; outline: none; }
    .order-modal input:focus, .order-modal textarea:focus { box-shadow: 0 0 0 3px #FF48B0; }
    .order-modal textarea { min-height: 84px; resize: vertical; }
    .order-modal .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .order-modal button[type=submit] { width: 100%; margin-top: 24px; padding: 14px; border: 1px solid #111; border-radius: 500px;
      background: #111; color: #F2F0EB; font-family: 'Space Mono', ui-monospace, monospace; font-size: 12px; letter-spacing: .2em;
      text-transform: uppercase; cursor: pointer; transition: background .25s, color .25s; }
    .order-modal button[type=submit]:hover:not(:disabled) { background: #FF48B0; color: #111; }
    .order-modal button[type=submit]:disabled { opacity: .5; cursor: not-allowed; }
    .order-close { position: absolute; top: 12px; right: 14px; border: 0; background: none; font-size: 22px; line-height: 1;
      cursor: pointer; color: #111; }
    .order-status { margin-top: 16px; padding: 12px; border: 1px solid #111; font-size: 14px; display: none; }
    .order-status.is-ok { display: block; background: #e6f4ea; }
    .order-status.is-error { display: block; background: #fde7ef; }
  `;

  var html = `
    <div class="order-modal" role="dialog" aria-modal="true" aria-labelledby="order-title">
      <button class="order-close" type="button" aria-label="Close">✕</button>
      <h2 id="order-title">Order a copy</h2>
      <p class="sub">We'll email you payment details right away.</p>
      <form novalidate>
        <label for="order-name">Full name</label>
        <input id="order-name" name="customer_name" type="text" required placeholder="Your name" autocomplete="name">
        <label for="order-email">Email</label>
        <input id="order-email" name="customer_email" type="email" required placeholder="you@example.com" autocomplete="email">
        <label for="order-address">Delivery address</label>
        <textarea id="order-address" name="customer_address" required placeholder="Street, city, postcode, country" autocomplete="street-address"></textarea>
        <div class="row">
          <div><label for="order-issue">Issue</label><input id="order-issue" name="issue" type="text" required readonly></div>
          <div><label for="order-qty">Quantity</label><input id="order-qty" name="quantity" type="number" min="1" value="1" required></div>
        </div>
        <button type="submit">Place order</button>
        <div class="order-status" role="status"></div>
      </form>
    </div>`;

  var overlay, form, status, submit, lastFocus;

  function build() {
    if (overlay) return;
    var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    overlay = document.createElement('div'); overlay.className = 'order-overlay'; overlay.innerHTML = html;
    document.body.appendChild(overlay);
    form = overlay.querySelector('form'); status = overlay.querySelector('.order-status'); submit = form.querySelector('button[type=submit]');
    overlay.querySelector('.order-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('is-open')) close(); });
    // keep wheel/touch scrolling inside the popup (pages with smooth scroll would otherwise take it)
    overlay.setAttribute('data-lenis-prevent', '');
    form.addEventListener('submit', send);
    if (window.emailjs) emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
  }

  function open(issue) {
    build();
    lastFocus = document.activeElement;
    form.reset();
    form.issue.value = issue || '';
    form.quantity.value = 1;
    status.className = 'order-status'; status.textContent = '';
    overlay.classList.add('is-open');
    document.documentElement.style.overflow = 'hidden';
    form.customer_name.focus();
  }

  function close() {
    overlay.classList.remove('is-open');
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  async function send(e) {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    var params = {
      customer_name: form.customer_name.value.trim(),
      customer_email: form.customer_email.value.trim(),
      customer_address: form.customer_address.value.trim(),
      issue: form.issue.value.trim(),
      quantity: form.quantity.value,
    };
    submit.disabled = true; submit.textContent = 'Sending…';
    status.className = 'order-status';
    try {
      if (!window.emailjs) throw new Error('EmailJS did not load');
      await emailjs.send(EMAILJS_SERVICE_ID, ORDER_TEMPLATE_ID, params);   // notify Junki
      await emailjs.send(EMAILJS_SERVICE_ID, REPLY_TEMPLATE_ID, params);   // auto-reply to the customer
      status.className = 'order-status is-ok';
      status.textContent = "Order received! Check your inbox, we've sent you payment details.";
      form.reset(); form.issue.value = params.issue;
    } catch (err) {
      status.className = 'order-status is-error';
      status.textContent = 'Something went wrong. Please try again or email us directly.';
      console.error(err);
    } finally {
      submit.disabled = false; submit.textContent = 'Place order';
    }
  }

  window.JunkiOrder = { open: open, close: close };
})();
