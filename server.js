const express = require('express');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const VAPID_PUBLIC_KEY = 'BJzsAIEa1fs0XMTL38zYoEl6pWhFQ-SFldAfHpY5yYf4LXiHk1T2XQrhvHfceCJZOOWHlfqtu7Kww4K64-EyFlI';
const VAPID_PRIVATE_KEY = '0HnL7LqAlC_2_QB-ESpiIec-D4mbysEMd36cu5fovp8';

webpush.setVapidDetails(
  'mailto:example@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const app = express();
app.use(express.json());

/* ---- Persistence ---- */

const DATA_DIR = path.join(__dirname, 'data');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');

function loadSubscriptions() {
  try {
    if (fs.existsSync(SUBS_FILE)) {
      return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load subscriptions:', e.message);
  }
  return [];
}

function saveSubscriptionsToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions, null, 2));
  } catch (e) {
    console.error('Failed to save subscriptions:', e.message);
  }
}

let subscriptions = loadSubscriptions();

/* ---- API: Subscribe ---- */

app.post('/api/subscribe', (req, res) => {
  const { subscription, locations } = req.body || {};
  if (!subscription) {
    return res.status(400).json({ error: 'No subscription' });
  }
  const subKey = JSON.stringify(subscription);
  const existing = subscriptions.find((s) => JSON.stringify(s.subscription) === subKey);
  if (existing) {
    existing.locations = locations || existing.locations;
  } else {
    subscriptions.push({ subscription, locations: locations || [] });
  }
  saveSubscriptionsToDisk();
  res.json({ success: true });
});

app.post('/api/unsubscribe', (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription) return res.status(400).json({ error: 'No subscription' });
  const subKey = JSON.stringify(subscription);
  const idx = subscriptions.findIndex((s) => JSON.stringify(s.subscription) === subKey);
  if (idx !== -1) {
    subscriptions.splice(idx, 1);
    saveSubscriptionsToDisk();
  }
  res.json({ success: true });
});

app.get('/api/vapid-key', (_req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY });
});

/* ---- Weather Fetch (server-side, for rule evaluation) ---- */

const weatherServerCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchWeatherForRules(loc) {
  const cacheKey = `${loc.latitude},${loc.longitude}`;
  const cached = weatherServerCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const params = [
    'temperature_2m', 'apparent_temperature', 'precipitation_probability',
    'weather_code', 'relative_humidity_2m', 'wind_speed_10m',
    'wind_gusts_10m', 'surface_pressure', 'precipitation', 'visibility'
  ].join(',');

  const url = `https://api.open-meteo.com/v1/dwd-icon?latitude=${loc.latitude}&longitude=${loc.longitude}&hourly=${params}&forecast_hours=168&model=icon_eu&timezone=Europe%2FPrague`;

  const resp = await fetch(url);
  const data = await resp.json();
  const h = data.hourly || {};
  const time = h.time || [];

  const hourly = time.map((t, i) => ({
    time: t,
    temperature_2m: (h.temperature_2m || [])[i],
    apparent_temperature: (h.apparent_temperature || [])[i],
    precipitation_probability: (h.precipitation_probability || [])[i] || 0,
    weather_code: (h.weather_code ?? h.weathercode ?? [])[i],
    relative_humidity_2m: (h.relative_humidity_2m || [])[i],
    wind_speed_10m: (h.wind_speed_10m ?? h.windspeed_10m ?? [])[i],
    wind_gusts_10m: (h.wind_gusts_10m ?? h.windgusts_10m ?? [])[i] || 0,
    surface_pressure: (h.surface_pressure || [])[i],
    precipitation: (h.precipitation || [])[i] || 0,
    visibility: (h.visibility || [])[i]
  }));

  weatherServerCache.set(cacheKey, { data: hourly, ts: Date.now() });
  return hourly;
}

/* ---- Rule Evaluation Engine ---- */

function evaluateCondition(condition, hourData) {
  let actual = hourData[condition.param];
  if (actual == null) return false;

  // visibility: API returns meters, user sets km
  if (condition.param === 'visibility') actual = actual / 1000;

  const val = condition.value;
  const op = condition.op;

  if (op === 'in') {
    return Array.isArray(val) && val.includes(actual);
  }
  switch (op) {
    case '>': return actual > val;
    case '<': return actual < val;
    case '>=': return actual >= val;
    case '<=': return actual <= val;
    case '==': return actual === val;
    default: return false;
  }
}

function evaluateRule(rule, hourlyData) {
  if (!rule.enabled || !rule.conditions || rule.conditions.length === 0) {
    return { triggered: false };
  }

  const horizon = Math.min(rule.timeHorizon || 24, hourlyData.length);
  const windowData = hourlyData.slice(0, horizon);

  // For each hour, check if all/any conditions match
  const logic = rule.logic || 'AND';
  const hourMatches = windowData.map((hourData) => {
    const results = rule.conditions.map((c) => evaluateCondition(c, hourData));
    return logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
  });

  const consecutive = rule.consecutiveHours;
  if (consecutive && consecutive > 1) {
    // Find N consecutive matching hours
    let count = 0;
    for (const match of hourMatches) {
      if (match) {
        count++;
        if (count >= consecutive) return { triggered: true };
      } else {
        count = 0;
      }
    }
    return { triggered: false };
  }

  // Any single hour match triggers
  return { triggered: hourMatches.some(Boolean) };
}

/* ---- Cooldown Tracking ---- */

const cooldowns = new Map(); // ruleId -> timestamp

function isCoolingDown(ruleId, cooldownMinutes) {
  if (!cooldownMinutes) return false;
  const last = cooldowns.get(ruleId);
  if (!last) return false;
  return Date.now() - last < cooldownMinutes * 60 * 1000;
}

function markTriggered(ruleId) {
  cooldowns.set(ruleId, Date.now());
}

/* ---- Rule Summary for Notification Body ---- */

const PARAM_LABELS = {
  temperature_2m: 'Teplota',
  apparent_temperature: 'Pocitová teplota',
  precipitation: 'Srážky',
  precipitation_probability: 'Pravděp. srážek',
  wind_speed_10m: 'Vítr',
  wind_gusts_10m: 'Nárazy větru',
  weather_code: 'Počasí',
  relative_humidity_2m: 'Vlhkost',
  visibility: 'Viditelnost',
  surface_pressure: 'Tlak'
};

const PARAM_UNITS = {
  temperature_2m: '°C', apparent_temperature: '°C',
  precipitation: 'mm', precipitation_probability: '%',
  wind_speed_10m: 'km/h', wind_gusts_10m: 'km/h',
  relative_humidity_2m: '%', visibility: 'km', surface_pressure: 'hPa'
};

function buildNotificationBody(rule) {
  const parts = rule.conditions.map((c) => {
    const label = PARAM_LABELS[c.param] || c.param;
    const unit = PARAM_UNITS[c.param] || '';
    if (c.op === 'in') return `${label}: splněno`;
    return `${label} ${c.op} ${c.value}${unit}`;
  });
  let text = parts.join(rule.logic === 'OR' ? ' nebo ' : ' a ');
  if (rule.consecutiveHours) text += ` po dobu ${rule.consecutiveHours}h`;
  text += ` (příštích ${rule.timeHorizon || 24}h)`;
  return text;
}

/* ---- Scheduling Loop ---- */

async function checkAllSubscriptions() {
  for (const sub of subscriptions) {
    for (const loc of (sub.locations || [])) {
      for (const rule of (loc.rules || [])) {
        if (!rule.enabled) continue;
        if (isCoolingDown(rule.id, rule.cooldownMinutes)) continue;

        try {
          const hourly = await fetchWeatherForRules(loc);
          const result = evaluateRule(rule, hourly);

          if (result.triggered) {
            markTriggered(rule.id);
            const payload = JSON.stringify({
              title: `${loc.name}: ${rule.name || 'Upozornění'}`,
              body: buildNotificationBody(rule),
              icon: 'icons/icon-192.png',
              badge: 'icons/icon-192.png'
            });
            try {
              await webpush.sendNotification(sub.subscription, payload);
              console.log(`Notification sent: ${loc.name} - ${rule.name}`);
            } catch (pushErr) {
              console.error('Push failed:', pushErr.message);
              // Remove invalid subscriptions (410 Gone)
              if (pushErr.statusCode === 410) {
                const idx = subscriptions.indexOf(sub);
                if (idx !== -1) subscriptions.splice(idx, 1);
                saveSubscriptionsToDisk();
                return; // Skip rest of this subscription
              }
            }
          }
        } catch (err) {
          console.error(`Rule check failed for ${loc.name}:`, err.message);
        }
      }
    }
  }
}

// Check every 5 minutes
setInterval(() => {
  checkAllSubscriptions().catch((e) => console.error('Check error:', e));
}, 5 * 60 * 1000);

// Also check shortly after startup
setTimeout(() => {
  checkAllSubscriptions().catch((e) => console.error('Initial check error:', e));
}, 30 * 1000);

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
