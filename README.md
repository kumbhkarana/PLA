# BIMO

BIMO helps SUD Life agents turn a Benefit Illustration (BI) into a clean, one-page image that shows a customer only what they need to know.

## Flow

**Login → Welcome → Select product → Continue → SUD Life BI portal → fill details → Generate BI → upload the PDF → clean illustration image**

1. **Login.** The username is the agent's name and the password is their code. Demo: `Karan` / `12345`.
2. **Home.** Shows "Welcome, *Name*" with the agent's tier badge (Platinum Agent), followed by all 35 SUD Life products, grouped by category and searchable.
3. **Continue.** Opens the product's page on the BI portal (`si.sudlife.in/Salesillustration/Input.aspx?ProductId=…`) in a new tab. The agent fills in the customer's details there and downloads the BI PDF.
4. **Upload.** The agent uploads that PDF to BIMO. BIMO reads it on the device (nothing is sent to a server) and picks out the main figures: customer, age, gender, plan option, policy term, premium paying term, premium, life cover, yearly income and maturity benefit.
5. **Illustration.** BIMO builds a branded card: what the customer pays, what they get back (and how many times their premiums that is), the key figures as tiles, a timeline of the policy, and the agent's name. The agent can correct any figure that was missed. **Download image** saves a PNG. **Share** sends it through the phone's share sheet, for example to WhatsApp.

> Why a new tab and not inside BIMO? The SUD Life portal doesn't allow itself to be embedded in other apps (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'none'`), so BIMO opens it in its own tab and the PDF is brought back in by upload.

## Run it

It is a static web app with no build step:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

It can be hosted on any static host (GitHub Pages, Netlify, Firebase Hosting). On a phone, use **Add to Home Screen** to install it like an app. A service worker lets it open offline.

## Customise

| What | Where |
|---|---|
| Agents (name, code, tier) | `js/config.js` → `users` |
| Products / BI links | `js/config.js` → `categories`, `portal` |
| Brand colours | `css/styles.css` → `:root` variables (`--brand`, `--accent`, …) |
| Logo | replace `assets/logo.svg` (the same file is used everywhere) |
| Illustration layout | `renderIllustration()` in `js/app.js`, `.illus*` styles |
| PDF field labels | `FIELDS` in `js/parser.js` |

## Notes

- Logins are checked in the browser, so they are for demo use only. Before real use, move authentication to a server.
- The PDF reader matches labels such as "Policy Term" and "Annualized Premium". If a product's BI uses different wording, add the label to `FIELDS` in `js/parser.js`. After an upload, `window.__bimoLastParse.rawText` in the browser console shows the text BIMO extracted.
- Libraries are stored in `vendor/`: pdf.js 3.11.174 and html2canvas 1.4.1.
