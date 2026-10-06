# BIMO

BIMO helps SUD Life agents generate a Benefit Illustration (BI) **inside the app** and turn it into a clean, one-page image that shows the customer only what they need to know.

## Flow

**Login → Welcome → Select product → Continue → fill details in BIMO → Generate BI → illustration image**

1. **Login.** The username is the agent's name and the password is their code. Demo: `Karan` / `12345`. Logins are checked on the server.
2. **Home.** Shows "Welcome, *Name*" with the agent's tier badge (Platinum Agent), followed by all 35 SUD Life products, grouped by category and searchable.
3. **Form.** BIMO builds the product's form from the SUD Life Sales Illustration system: life assured, proposer, benefit option, distribution channel, policy term, premium paying term, mode, premium and age proof. Dropdowns follow the portal's own rules; for example, the PPT list depends on the chosen policy term.
4. **Generate BI.** BIMO sends the inputs to the portal's calculation engine. Validation messages (e.g. "Minimum Sum Assured is 3,78,000") are shown on the form.
5. **Illustration.** The official figures are turned into a branded card showing:
   - what the customer pays against what they could receive (guaranteed, and at the 4% and 8% assumed rates)
   - life cover, guaranteed maturity and policy term
   - a pay/grow/income timeline
   - the agent's name

   **Download image** saves a PNG. **Share** opens the phone's share sheet (e.g. WhatsApp). **Official BI (PDF)** downloads the portal's full BI.

## How it works

```
Phone (BIMO app)  ──►  BIMO server (Node)  ──►  si.sudlife.in  (Sales Illustration engine)
   form + image          login, sessions,         calculates premium, sum assured
   (html2canvas)         portal relay, BI parser  and the year-wise benefit table
```

The browser can't call si.sudlife.in directly (it allows no cross-site requests and can't be embedded in another app). The small BIMO server keeps one portal session per logged-in agent and makes the calls the portal's own page would make:
- product lookups: terms, modes, options
- the encrypted validation call
- `GenerateBIPDF`

`server/biParser.js` reads the returned BI, including its multi-level year-wise table, and works out the summary figures.

## Run it

Node 18 or newer, with no dependencies to install:

```bash
npm start              # http://localhost:8080   (PORT=3000 npm start to change)
```

Deploy it on any Node host (Render, Railway, a VPS, Azure App Service, …) and serve it over HTTPS. On a phone, use **Add to Home Screen** to install it like an app.

If your network routes outbound traffic through a proxy, start it with `NODE_USE_ENV_PROXY=1` (Node 22.21 or newer).

## Customise

| What | Where |
|---|---|
| Agents (name, code, tier) | `server/users.json` (or point `BIMO_USERS` at another file) |
| Products shown on Home | `js/config.js` → `categories` |
| Brand colours | `css/styles.css` → `:root` variables (`--brand`, `--accent`, …) |
| Logo | replace `assets/logo.svg` |
| Illustration layout | `renderIllustration()` in `js/app.js`, `.illus*` and `.bar*` styles |
| Summary figures | `summarize()` in `server/biParser.js` |

## Notes

- **Tested end to end with SUD Life Fortune Plus.** The figures match the official BI exactly, including annual and monthly modes and the portal's validation errors. Other traditional (non-linked) products use the same engine and should work, but each needs a check. ULIPs (fund choice), annuity products and underwriting-extra fields (EMR / flat extra) are not supported in the form yet.
- BIMO depends on the portal's internal page calls. If SUD Life changes its BI page, `server/portal.js` may need an update. For production, ask SUD Life for official API access.
- The portal has bot protection. BIMO reuses one portal session per agent and retries once if blocked, but very heavy use from a single server IP could still be throttled.
- Agent codes are stored in plain text in `server/users.json`. Replace this with the company's agent login system before rollout.
