/**
 * scripts/seed.mjs — one-time setup seeding for the Outlet Rotation App.
 *
 * Creates the generic, known data and solves the admin chicken-and-egg:
 *   - Outlets: Taft, Pine Hills
 *   - Commodities: Textiles, Wares, Shoes, Accessories, Books & Media
 *   - A default OutletSettings row per outlet (8:00 AM–4:00 PM, 60/120 min
 *     freshness thresholds, misc amount 0) — tweak later in the Admin Center
 *   - Your FIRST Admin Center user (username + password prompted at the
 *     terminal, hashed exactly the way the app verifies it)
 *
 * Everything else (each outlet's Sections, the SectionCommodityMix
 * quantities, and CommodityDailyGoals) you set in the Admin Center UI once
 * this has run and you can log in.
 *
 * Run from the project root:
 *   node --env-file=.env.local scripts/seed.mjs
 *
 * Safe to re-run: it skips anything that already exists (matched by name).
 * Uses only the app-only Graph token (client credentials + Sites.Selected),
 * so it needs ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET /
 * SHAREPOINT_SITE_ID from .env.local — all already present.
 */
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

// ---- config from env ------------------------------------------------------
const TENANT = process.env.ENTRA_TENANT_ID;
const CLIENT_ID = process.env.ENTRA_CLIENT_ID;
const CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET;
const SITE_ID = process.env.SHAREPOINT_SITE_ID;

for (const [name, val] of [
  ["ENTRA_TENANT_ID", TENANT],
  ["ENTRA_CLIENT_ID", CLIENT_ID],
  ["ENTRA_CLIENT_SECRET", CLIENT_SECRET],
  ["SHAREPOINT_SITE_ID", SITE_ID],
]) {
  if (!val) {
    console.error(
      `\n✗ ${name} is missing from .env.local.\n  Did you run this with:  node --env-file=.env.local scripts/seed.mjs ?\n`,
    );
    process.exit(1);
  }
}

// ---- password hashing (must match lib/security/password.ts) ---------------
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024; // must match lib/security/password.ts

async function hashPassword(password) {
  const salt = randomBytes(16);
  const dk = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("hex"),
    dk.toString("hex"),
  ].join(":");
}

// ---- Eastern-time helper (matches lib/time.ts) ----------------------------
const TZ = "America/New_York";
function zoneOffsetMinutes(date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const m = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") m[p.type] = Number(p.value);
  }
  const h = m.hour === 24 ? 0 : m.hour;
  const asUtc = Date.UTC(m.year, m.month - 1, m.day, h, m.minute, m.second);
  return (asUtc - date.getTime()) / 60000;
}
function etDateString(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
function etWallTimeToIso(dateStr, hh, mm) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  let inst = guess - zoneOffsetMinutes(new Date(guess)) * 60000;
  inst = guess - zoneOffsetMinutes(new Date(inst)) * 60000;
  return new Date(inst).toISOString();
}

// ---- Graph helpers --------------------------------------------------------
let TOKEN = null;
async function getToken() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()).access_token;
}

async function graph(method, path, body) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

async function resolveLists() {
  const r = await graph(
    "GET",
    `/sites/${SITE_ID}/lists?$select=id,displayName,name&$top=200`,
  );
  const map = new Map();
  for (const l of r.value) {
    if (l.displayName) map.set(l.displayName.toLowerCase(), l.id);
    if (l.name) map.set(l.name.toLowerCase(), l.id);
  }
  return (name) => {
    const id = map.get(name.toLowerCase());
    if (!id) {
      throw new Error(
        `SharePoint list "${name}" not found on the site. Check the list name matches exactly.`,
      );
    }
    return id;
  };
}

async function getItems(listId) {
  const r = await graph(
    "GET",
    `/sites/${SITE_ID}/lists/${listId}/items?$expand=fields&$top=500`,
  );
  return r.value;
}

async function ensureByTitle(listId, title, fields) {
  const items = await getItems(listId);
  const found = items.find(
    (i) => (i.fields?.Title ?? "").toLowerCase() === title.toLowerCase(),
  );
  if (found) {
    console.log(`   = exists: ${title}`);
    return found;
  }
  const created = await graph("POST", `/sites/${SITE_ID}/lists/${listId}/items`, {
    fields,
  });
  console.log(`   + created: ${title}`);
  return created;
}

// ---- terminal prompts -----------------------------------------------------
function ask(query) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout });
    rl.question(query, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}
function askHidden(query) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) stdout.write(s);
    };
    stdout.write(query);
    muted = true;
    rl.question("", (a) => {
      rl.close();
      stdout.write("\n");
      resolve(a);
    });
  });
}

// ---- main -----------------------------------------------------------------
async function main() {
  console.log("\nOutlet Rotation App — seeding\n");
  TOKEN = await getToken();
  console.log("✓ Got app-only Graph token (Sites.Selected)\n");

  const listId = await resolveLists();
  const outletsList = listId("Outlets");
  const commoditiesList = listId("Commodities");
  const settingsList = listId("OutletSettings");
  const adminList = listId("AdminUsers");

  // Outlets
  console.log("Outlets:");
  const outletNames = ["Taft", "Pine Hills"];
  const outletIdByName = {};
  for (const name of outletNames) {
    const item = await ensureByTitle(outletsList, name, {
      Title: name,
      IsActive: true,
    });
    outletIdByName[name] = item.id;
  }

  // Commodities
  console.log("\nCommodities:");
  const commodities = [
    ["Textiles", 1],
    ["Wares", 2],
    ["Shoes", 3],
    ["Accessories", 4],
    ["Books & Media", 5],
  ];
  for (const [name, order] of commodities) {
    await ensureByTitle(commoditiesList, name, {
      Title: name,
      DisplayOrder: order,
      IsActive: true,
    });
  }

  // Default OutletSettings per outlet
  console.log("\nOutlet settings (defaults — edit later in Admin Center):");
  const today = etDateString();
  const settingsItems = await getItems(settingsList);
  for (const name of outletNames) {
    const outletId = outletIdByName[name];
    const exists = settingsItems.find(
      (i) => String(i.fields?.OutletLookupId ?? "") === String(outletId),
    );
    if (exists) {
      console.log(`   = settings exist: ${name}`);
      continue;
    }
    await graph("POST", `/sites/${SITE_ID}/lists/${settingsList}/items`, {
      fields: {
        Title: name,
        OutletLookupId: Number(outletId),
        OperatingHoursStart: etWallTimeToIso(today, 8, 0),
        OperatingHoursEnd: etWallTimeToIso(today, 16, 0),
        GreenThresholdMinutes: 60,
        YellowThresholdMinutes: 120,
        MiscAmount: 0,
      },
    });
    console.log(`   + settings created: ${name} (8:00 AM–4:00 PM)`);
  }

  // First admin user
  console.log("\nFirst Admin Center user:");
  const adminItems = await getItems(adminList);
  const username = await ask("   Username: ");
  if (!username) {
    console.log("   (no username entered — skipping admin creation)");
  } else if (
    adminItems.find(
      (i) => (i.fields?.Title ?? "").toLowerCase() === username.toLowerCase(),
    )
  ) {
    console.log(`   = admin "${username}" already exists — leaving it as is.`);
  } else {
    const pw1 = await askHidden("   Password: ");
    const pw2 = await askHidden("   Confirm password: ");
    if (!pw1 || pw1 !== pw2) {
      console.error("   ✗ Passwords empty or didn't match — admin NOT created.");
    } else {
      const hash = await hashPassword(pw1);
      await graph("POST", `/sites/${SITE_ID}/lists/${adminList}/items`, {
        fields: {
          Title: username,
          PasswordHash: hash,
          DisplayName: username,
          IsActive: true,
          FailedAttempts: 0,
        },
      });
      console.log(`   + admin created: ${username}`);
    }
  }

  console.log(
    "\n✓ Done. Next: open the app, go to Admin Center, sign in with that admin,\n  and configure each outlet's Sections, mix, and daily goals.\n",
  );
}

main().catch((err) => {
  console.error("\n✗ Seed failed:\n", err.message ?? err, "\n");
  process.exit(1);
});
