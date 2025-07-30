const express = require('express');
const webpush = require('web-push');

const VAPID_PUBLIC_KEY = 'BJzsAIEa1fs0XMTL38zYoEl6pWhFQ-SFldAfHpY5yYf4LXiHk1T2XQrhvHfceCJZOOWHlfqtu7Kww4K64-EyFlI';
const VAPID_PRIVATE_KEY = '0HnL7LqAlC_2_QB-ESpiIec-D4mbysEMd36cu5fovp8';

webpush.setVapidDetails(
  'mailto:example@example.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const app = express();
app.use(express.json());

const subscriptions = [];

app.post('/api/subscribe', (req, res) => {
  const { subscription, locations, notificationTime } = req.body || {};
  if (!subscription) {
    return res.status(400).json({ error: 'No subscription' });
  }
  const existing = subscriptions.find((s) =>
    JSON.stringify(s.subscription) === JSON.stringify(subscription)
  );
  if (existing) {
    existing.locations = locations || existing.locations;
    existing.notificationTime = notificationTime || existing.notificationTime;
  } else {
    subscriptions.push({ subscription, locations: locations || [], notificationTime: notificationTime || '07:00' });
  }
  res.json({ success: true });
});

async function fetchWeather(loc) {
  const { latitude, longitude } = loc;
  const d2Url = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation,precipitation_probability,weathercode&forecast_hours=48&model=icon_d2&timezone=Europe%2FPrague`;
  const euUrl = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation,precipitation_probability,weathercode&forecast_hours=72&model=icon_eu&timezone=Europe%2FPrague`;
  const [d2Resp, euResp] = await Promise.all([fetch(d2Url), fetch(euUrl)]);
  const d2Data = await d2Resp.json();
  const euData = await euResp.json();
  const time = (d2Data.hourly?.time || []).concat(euData.hourly?.time || []);
  const temps = (d2Data.hourly?.temperature_2m || []).concat(euData.hourly?.temperature_2m || []);
  const precipitation = (d2Data.hourly?.precipitation || []).concat(euData.hourly?.precipitation || []);
  const precipitationProb = (d2Data.hourly?.precipitation_probability || []).concat(euData.hourly?.precipitation_probability || []);
  const daily = {};
  for (let i = 0; i < time.length; i++) {
    const dateStr = time[i].split('T')[0];
    if (!daily[dateStr]) {
      daily[dateStr] = { temps: [], precip: 0, precipProbMax: 0 };
    }
    daily[dateStr].temps.push(temps[i]);
    daily[dateStr].precip += precipitation[i] || 0;
    daily[dateStr].precipProbMax = Math.max(daily[dateStr].precipProbMax, precipitationProb[i] || 0);
  }
  return Object.keys(daily)
    .sort()
    .slice(0, 2)
    .map((dateStr) => {
      const info = daily[dateStr];
      const tempMax = Math.max(...info.temps);
      return {
        precipitation: info.precip,
        precipProb: info.precipProbMax,
        tempMax
      };
    });
}

async function checkSubscription(sub) {
  const now = new Date();
  const [h, m] = (sub.notificationTime || '07:00').split(':').map((v) => parseInt(v, 10));
  if (now.getHours() !== h || now.getMinutes() !== m) {
    return;
  }
  const messages = [];
  for (const loc of sub.locations) {
    try {
      const days = await fetchWeather(loc);
      const willRain = days.some((d) => d.precipitation >= 1 || d.precipProb > 50);
      const willSwim = days.some((d) => d.tempMax >= 25 && d.precipitation < 1);
      if (willRain) {
        messages.push(`\u{1F327}\u{FE0F} ${loc.name}: během následujících 48 h může pršet`);
      } else if (willSwim) {
        messages.push(`\u{1F3D6}\u{FE0F} ${loc.name}: v příštích 48 h to vypadá na koupání!`);
      }
    } catch (err) {
      console.error('Weather check failed:', err);
    }
  }
  if (messages.length > 0) {
    const payload = JSON.stringify({
      title: 'Předpověď na 48 hodin',
      body: messages.join('\n'),
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png'
    });
    try {
      await webpush.sendNotification(sub.subscription, payload);
    } catch (err) {
      console.error('Push failed:', err);
    }
  }
}

setInterval(() => {
  subscriptions.forEach((sub) => {
    checkSubscription(sub).catch((e) => console.error('Check error:', e));
  });
}, 60 * 1000);

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
