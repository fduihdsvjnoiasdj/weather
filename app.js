/*
 * Hlavní skript pro PWA aplikaci Předpověď počasí.
 * Zajišťuje načtení dat z API Open‑Meteo, vyhledávání měst pomocí geokódovacího API,
 * zobrazování předpovědí v českém jazyce a plánování denních notifikací.
 */

// Po načtení DOM zaregistrujeme service worker a inicializujeme aplikaci
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  initApp();
});

// VAPID veřejný klíč pro Web Push
const VAPID_PUBLIC_KEY =
  'BJzsAIEa1fs0XMTL38zYoEl6pWhFQ-SFldAfHpY5yYf4LXiHk1T2XQrhvHfceCJZOOWHlfqtu7Kww4K64-EyFlI';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

// Registrace service workeru pro PWA funkce
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('sw.js')
      .then((reg) => {
        console.log('SW registrován', reg);
      })
      .catch((err) => {
        console.error('Chyba SW', err);
      });
  }
}

// Výchozí města, pokud nejsou uložena v localStorage
const DEFAULT_CITIES = [
  {
    name: 'Roudnice nad Labem',
    // zeměpisné souřadnice budou nalezeny pomocí geokódovacího API
  },
  {
    name: 'Praha'
  }
];

// Klíče v localStorage
const LOCATIONS_KEY = 'weatherAppLocations';
const SETTINGS_KEY = 'weatherAppSettings';

// Globální proměnné
let locations = [];
let notificationIntervalId;

async function initApp() {
  // Načíst uložená města nebo použít výchozí
  locations = await loadLocations();
  await updateAllLocations();

  // Nastavit hledání měst
  setupSearch();

  // Načíst a nastavit čas notifikace
  loadSettingsToUI();
  document.getElementById('save-settings').addEventListener('click', saveSettingsFromUI);

  // Naplánovat pravidelnou kontrolu pro zasílání notifikací
  scheduleDailyNotifications();

  document
    .getElementById('subscribeBtn')
    .addEventListener('click', handleEnableNotifications);
}

/**
 * Načte seznam uložených měst z localStorage. Pokud není uložen žádný záznam,
 * využije výchozí seznam a nechá pro jednotlivé záznamy doplnit souřadnice.
 */
async function loadLocations() {
  const stored = localStorage.getItem(LOCATIONS_KEY);
  let locs;
  if (stored) {
    try {
      locs = JSON.parse(stored);
    } catch (e) {
      locs = [];
    }
  } else {
    locs = [...DEFAULT_CITIES];
  }
  // U každého města doplníme souřadnice, pokud chybí
  for (const loc of locs) {
    if (!loc.latitude || !loc.longitude) {
      const geo = await geocodeCity(loc.name);
      if (geo) {
        loc.latitude = geo.latitude;
        loc.longitude = geo.longitude;
      }
    }
  }
  // Uložit zpět do localStorage
  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locs));
  return locs;
}

/**
 * Uloží seznam měst do localStorage.
 */
function saveLocations() {
  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locations));
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => {
        if (sub) {
          sendSubscriptionData(sub);
        }
      })
    );
  }
}

/**
 * Načte nastavení notifikací a zobrazí je v UI.
 */
function loadSettingsToUI() {
  const stored = localStorage.getItem(SETTINGS_KEY);
  let settings;
  if (stored) {
    try {
      settings = JSON.parse(stored);
    } catch (e) {
      settings = {};
    }
  } else {
    settings = { notificationTime: '07:00' };
  }
  document.getElementById('notification-time').value = settings.notificationTime || '07:00';
}

/**
 * Uloží nastavení notifikací z UI do localStorage a přenastaví plánovač.
 */
function saveSettingsFromUI() {
  const time = document.getElementById('notification-time').value;
  const settings = { notificationTime: time };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  // Přeplánovat notifikace
  scheduleDailyNotifications();
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => {
        if (sub) {
          sendSubscriptionData(sub);
        }
      })
    );
  }
  alert('Nastavení uloženo.');
}

/**
 * Zajistí vyhledávání měst pomocí geokódovacího API. Po zadání alespoň 3 znaků
 * vyhledá výsledky a zobrazí je pod textovým polem. Po kliknutí na výsledek
 * přidá město do seznamu a načte jeho předpověď.
 */
function setupSearch() {
  const searchInput = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');
  let searchTimeout;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    clearTimeout(searchTimeout);
    if (query.length < 3) {
      resultsContainer.innerHTML = '';
      return;
    }
    // Delay vyhledávání pro snížení počtu požadavků
    searchTimeout = setTimeout(async () => {
      const results = await geocodeSearch(query);
      // Zobrazit výsledky
      resultsContainer.innerHTML = '';
      results.forEach((res) => {
        const div = document.createElement('div');
        div.textContent = `${res.name}, ${res.admin1} (${res.latitude.toFixed(2)}, ${res.longitude.toFixed(2)})`;
        div.addEventListener('click', () => {
          // Přidat nové město
          const newLocation = {
            name: res.name,
            latitude: res.latitude,
            longitude: res.longitude
          };
          // Zkontrolovat duplicitu
          if (!locations.some((l) => l.name.toLowerCase() === newLocation.name.toLowerCase())) {
            locations.push(newLocation);
            saveLocations();
            updateAllLocations();
          }
          resultsContainer.innerHTML = '';
          searchInput.value = '';
        });
        resultsContainer.appendChild(div);
      });
    }, 400);
  });
}

/**
 * Vyhledá město pomocí geokódovacího API. Vrací až 5 výsledků.
 * API: https://geocoding-api.open-meteo.com/v1/search
 */
async function geocodeSearch(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    query
  )}&count=5&language=cs&countryCode=CZ`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    return data.results || [];
  } catch (error) {
    console.error('Chyba při vyhledávání města:', error);
    return [];
  }
}

/**
 * Vyhledá první výsledek města podle názvu a vrátí jeho souřadnice.
 */
async function geocodeCity(name) {
  const results = await geocodeSearch(name);
  return results[0];
}

/**
 * Aktualizuje předpověď pro všechna uložená města a vykreslí je do DOM.
 */
async function updateAllLocations() {
  const container = document.getElementById('locations-container');
  container.innerHTML = '';
  for (const loc of locations) {
    // Pokud má město souřadnice, načti předpověď
    if (loc.latitude && loc.longitude) {
      const weather = await fetchWeather(loc);
      const card = createLocationCard(loc, weather);
      container.appendChild(card);
    }
  }
}

/**
 * Načte počasí pro dané místo z API Open‑Meteo. Využívá koncové body s modely
 * ICON‑D2 (48 hodin) a ICON‑EU (72 hodin), spojí získané hodinové hodnoty a
 * vytvoří denní souhrny.
 */
async function fetchWeather(loc) {
  const { latitude, longitude } = loc;
  try {
    // Dotazy na jednotlivé modely. Pro první dva dny použijeme model ICON‑D2,
    // který poskytuje vysoké rozlišení, a pro další tři dny model ICON‑EU.
    const d2Url = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation,precipitation_probability,weathercode,shortwave_radiation&forecast_hours=48&model=icon_d2&timezone=Europe%2FPrague`;
    const euUrl = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation,precipitation_probability,weathercode&forecast_hours=72&model=icon_eu&timezone=Europe%2FPrague`;
    const [d2Resp, euResp] = await Promise.all([fetch(d2Url), fetch(euUrl)]);
    const d2Data = await d2Resp.json();
    const euData = await euResp.json();
    // Sloučení časových řad
    const time = (d2Data.hourly?.time || []).concat(euData.hourly?.time || []);
    const temps = (d2Data.hourly?.temperature_2m || []).concat(
      euData.hourly?.temperature_2m || []
    );
    const precipitation = (d2Data.hourly?.precipitation || []).concat(
      euData.hourly?.precipitation || []
    );
    const precipitationProb = (d2Data.hourly?.precipitation_probability || []).concat(
      euData.hourly?.precipitation_probability || []
    );
    const codes = (d2Data.hourly?.weathercode || []).concat(
      euData.hourly?.weathercode || []
    );
    const shortwave = d2Data.hourly?.shortwave_radiation || [];
    // Vytvořit denní souhrny (5 dní)
    const daily = {};
    for (let i = 0; i < time.length; i++) {
      const dateStr = time[i].split('T')[0];
      if (!daily[dateStr]) {
        daily[dateStr] = {
          temps: [],
          precip: 0,
          precipProbMax: 0,
          codes: []
        };
      }
      daily[dateStr].temps.push(temps[i]);
      daily[dateStr].precip += precipitation[i] || 0;
      daily[dateStr].precipProbMax = Math.max(
        daily[dateStr].precipProbMax,
        precipitationProb[i] || 0
      );
      daily[dateStr].codes.push(codes[i]);
    }
    // Převést na pole a spočítat statistiky
    const dailyArray = Object.keys(daily)
      .sort()
      .slice(0, 5)
      .map((dateStr) => {
        const info = daily[dateStr];
        const tempMax = Math.max(...info.temps);
        const tempMin = Math.min(...info.temps);
        const codeCounts = {};
        info.codes.forEach((c) => {
          codeCounts[c] = (codeCounts[c] || 0) + 1;
        });
        const weatherCode = parseInt(
          Object.keys(codeCounts).reduce((a, b) => (codeCounts[a] > codeCounts[b] ? a : b))
        );
        return {
          date: dateStr,
          tempMax,
          tempMin,
          precipitation: info.precip,
          precipProb: info.precipProbMax,
          weatherCode
        };
      });

    // Podrobné úseky pro první dva dny
    const segments = {};
    const limit = Math.min(time.length, 48); // pouze 48 hodin
    for (let i = 0; i < limit; i++) {
      const d = new Date(time[i]);
      const h = d.getHours();
      const dateStr = d.toISOString().split('T')[0];
      if (!segments[dateStr]) {
        segments[dateStr] = {
          night: { precip: 0, swim: 0 },
          morning: { precip: 0, swim: 0 },
          day: { precip: 0, swim: 0 }
        };
      }
      let part;
      if (h < 6 || h >= 22) part = 'night';
      else if (h < 12) part = 'morning';
      else part = 'day';
      segments[dateStr][part].precip += precipitation[i] || 0;
      if (temps[i] >= 25 && precipitation[i] < 1) {
        segments[dateStr][part].swim += 1;
      }
    }
    const segmentsArray = Object.keys(segments)
      .sort()
      .slice(0, 2)
      .map((dateStr) => ({ date: dateStr, ...segments[dateStr] }));

    const hourly = {
      time: (d2Data.hourly?.time || []).slice(0, 48),
      precipitation: (d2Data.hourly?.precipitation || []).slice(0, 48),
      sunshine: shortwave.slice(0, 48)
    };

    return { daily: dailyArray, segments: segmentsArray, hourly };
  } catch (error) {
    console.error('Chyba při načítání předpovědi:', error);
    return { daily: [], segments: [], hourly: { time: [], precipitation: [], sunshine: [] } };
  }
}

/**
 * Vytvoří DOM kartu pro město a jeho předpověď.
 */
function createLocationCard(loc, weather) {
  const card = document.createElement('div');
  card.className = 'location-card';
  // Hlavička s názvem města a tlačítkem pro odstranění
  const header = document.createElement('div');
  header.className = 'location-header';
  const title = document.createElement('h2');
  title.textContent = loc.name;
  header.appendChild(title);
  const removeBtn = document.createElement('button');
  removeBtn.textContent = '×';
  removeBtn.className = 'remove-btn';
  removeBtn.title = 'Odstranit město';
  removeBtn.addEventListener('click', () => {
    // Odebrat město ze seznamu a znovu vykreslit
    locations = locations.filter((l) => l !== loc);
    saveLocations();
    updateAllLocations();
  });
  header.appendChild(removeBtn);
  card.appendChild(header);

  const chart = document.createElement('canvas');
  chart.className = 'hourly-chart';
  chart.width = 500;
  chart.height = 150;
  card.appendChild(chart);
  drawHourlyChart(chart, weather.hourly);

  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  legend.innerHTML =
    '<div class="legend-item"><span class="legend-color sun"></span> Sluneční svit</div>' +
    '<div class="legend-item"><span class="legend-color rain"></span> Srážky</div>';
  card.appendChild(legend);

  // Tělo předpovědi
  const grid = document.createElement('div');
  grid.className = 'forecast-grid';

  const dailyForecast = weather.daily;
  const segments = {};
  weather.segments.forEach((s) => {
    segments[s.date] = s;
  });

  dailyForecast.forEach((day, idx) => {
    const dayDiv = document.createElement('div');
    dayDiv.className = 'forecast-day';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'icon';
    iconSpan.textContent = getWeatherIcon(day.weatherCode);
    dayDiv.appendChild(iconSpan);
    const dateP = document.createElement('div');
    const date = new Date(day.date);
    // formát datumu v češtině (např. po 1.8.)
    dateP.textContent = date
      .toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' })
      .replace('.', '');
    dayDiv.appendChild(dateP);
    const tempP = document.createElement('div');
    tempP.textContent = `${Math.round(day.tempMax)}° / ${Math.round(day.tempMin)}°`;
    dayDiv.appendChild(tempP);
    if (idx < 2 && segments[day.date]) {
      ['night', 'morning', 'day'].forEach((part) => {
        const seg = document.createElement('div');
        seg.className = 'segment';
        const info = segments[day.date][part];
        let icon = '🙂';
        let text = '—';
        if (info.swim > 0) {
          icon = '🏖️';
          text = `${info.swim} h koupání`;
        } else if (info.precip >= 1) {
          icon = '🌧️😢';
          text = `${info.precip.toFixed(1)} mm`;
        }
        seg.innerHTML = `<span>${part === 'night' ? 'Noc' : part === 'morning' ? 'Ráno' : 'Den'}</span> <span>${icon}</span> <span>${text}</span>`;
        dayDiv.appendChild(seg);
      });
    } else {
      if (day.tempMax >= 25 && day.precipitation < 1) {
        const swim = document.createElement('div');
        swim.textContent = '🏖️';
        dayDiv.appendChild(swim);
      } else if (day.precipitation >= 1 || day.precipProb > 50) {
        const rain = document.createElement('div');
        rain.textContent = '🌧️';
        dayDiv.appendChild(rain);
      }
    }
    grid.appendChild(dayDiv);
  });
  card.appendChild(grid);
  return card;
}

function drawHourlyChart(canvas, hourly) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  const count = hourly.time.length;
  if (count === 0) return;
  const maxPrecip = Math.max(...hourly.precipitation, 1);
  const maxSun = Math.max(...hourly.sunshine, 1);
  const stepX = width / count;

  // osa x
  ctx.strokeStyle = '#888';
  ctx.beginPath();
  ctx.moveTo(0, height - 20);
  ctx.lineTo(width, height - 20);
  ctx.stroke();

  // labels hours every 6h
  ctx.fillStyle = '#333';
  ctx.font = '10px sans-serif';
  for (let i = 0; i < count; i += 6) {
    const d = new Date(hourly.time[i]);
    const label = d.getHours().toString();
    ctx.fillText(label, i * stepX + stepX / 2 - 5, height - 5);
  }

  // precipitation line
  ctx.strokeStyle = '#2196f3';
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const y = height - 20 - (hourly.precipitation[i] / maxPrecip) * (height - 40);
    const x = i * stepX + stepX / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // sunshine line
  ctx.strokeStyle = '#ffd600';
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const y = height - 20 - (hourly.sunshine[i] / maxSun) * (height - 40);
    const x = i * stepX + stepX / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * Vrátí vhodnou emotikonu podle WMO kódu počasí.
 * Definice kódů pochází z dokumentace API Open‑Meteo【839459858877162†L852-L867】.
 */
function getWeatherIcon(code) {
  if (code === 0) return '☀️'; // jasno
  if ([1, 2, 3].includes(code)) return '🌤️'; // oblačno
  if ([45, 48].includes(code)) return '🌫️'; // mlha
  if ([51, 53, 55].includes(code)) return '🌦️'; // mrholení
  if ([56, 57].includes(code)) return '🌧️'; // mrznoucí mrholení
  if ([61, 63, 65, 80, 81, 82].includes(code)) return '🌧️'; // déšť
  if ([66, 67].includes(code)) return '🌧️'; // mrznoucí déšť
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '❄️'; // sněžení
  if ([95, 96, 99].includes(code)) return '⛈️'; // bouřka
  return '☁️'; // výchozí
}

// Pokusí se naplánovat notifikaci pomocí Notification Triggers.
// Vrátí true, pokud bylo naplánování úspěšné.
async function scheduleNotificationTrigger(timeStr) {
  if (!('showTrigger' in Notification.prototype)) {
    return false;
  }
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission !== 'granted') {
    return false;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    return false;
  }

  const [h, m] = timeStr.split(':').map((v) => parseInt(v, 10));
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const messages = [];
  for (const loc of locations) {
    try {
      const weather = await fetchWeather(loc);
      const daily = weather.daily;
      if (daily && daily.length > 0) {
        const firstTwo = daily.slice(0, 2);
        const willRain = firstTwo.some((d) => d.precipitation >= 1 || d.precipProb > 50);
        const willSwim = firstTwo.some((d) => d.tempMax >= 25 && d.precipitation < 1);
        if (willRain) {
          messages.push(`🌧️ ${loc.name}: během následujících 48 h může pršet`);
        } else if (willSwim) {
          messages.push(`🏖️ ${loc.name}: v příštích 48 h to vypadá na koupání!`);
        }
      }
    } catch (err) {
      console.error('Chyba při plánování notifikace:', err);
    }
  }

  if (messages.length === 0) {
    return false;
  }

  const body = messages.join('\n');
  registration.showNotification('Předpověď na 48 hodin', {
    body,
    badge: 'icons/icon-192.png',
    icon: 'icons/icon-192.png',
    showTrigger: new TimestampTrigger(target.getTime()),
    tag: 'daily-weather'
  });
  return true;
}

/**
 * Naplánuje periodickou kontrolu pro odesílání denních notifikací. Každou
 * minutu zkontroluje, zda nastal nastavený čas. Pokud ano, zavolá funkci
 * checkForNotification() pro všechny uložené lokace.
 */
async function scheduleDailyNotifications() {
  // Zrušit případný existující interval
  if (notificationIntervalId) {
    clearInterval(notificationIntervalId);
  }

  const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  const targetTime = settings.notificationTime || '07:00';

  // Pokus o naplánování pomocí Notification Triggers (Chrome/Android)
  const triggerScheduled = await scheduleNotificationTrigger(targetTime);
  if (triggerScheduled) {
    return;
  }

  // Fallback pomocí běžného intervalu – funguje pouze při otevřené aplikaci
  notificationIntervalId = setInterval(async () => {
    const now = new Date();
    const [h, m] = targetTime.split(':').map((v) => parseInt(v, 10));
    if (now.getHours() === h && now.getMinutes() === m) {
      // Počkej několik sekund, aby se předešlo opakovaným notifikacím v rámci minuty
      clearInterval(notificationIntervalId);
      await checkForNotification();
      // Obnov interval až za minutu, aby nedošlo k více notifikacím
      setTimeout(() => {
        scheduleDailyNotifications();
      }, 60 * 1000);
    }
  }, 30 * 1000); // kontrola každých 30 sekund
}

/**
 * Zkontroluje pro každé uložené město, zda je v daný den koupací den či déšť,
 * a zobrazí notifikaci.
 */
async function checkForNotification() {
  // Zjisti, zda uživatel povolil notifikace
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission !== 'granted') {
    return;
  }
  for (const loc of locations) {
    try {
      const weather = await fetchWeather(loc);
      const daily = weather.daily;
      if (daily && daily.length > 0) {
        const firstTwo = daily.slice(0, 2);
        const willRain = firstTwo.some((d) => d.precipitation >= 1 || d.precipProb > 50);
        const willSwim = firstTwo.some((d) => d.tempMax >= 25 && d.precipitation < 1);
        if (willRain) {
          showNotification(`Deštníkový alarm pro ${loc.name}!`, {
            body: 'Během příštích 48 hodin má sprchnout.',
            badge: 'icons/icon-192.png',
            icon: 'icons/icon-192.png'
          });
        } else if (willSwim) {
          showNotification(`Hurá k vodě do ${loc.name}!`, {
            body: 'V následujících 48 hodinách bude koupací počasí.',
            badge: 'icons/icon-192.png',
            icon: 'icons/icon-192.png'
          });
        }
      }
    } catch (err) {
      console.error('Chyba při kontrole notifikací:', err);
    }
  }
}

/**
 * Vykreslí notifikaci pomocí service workeru, pokud je k dispozici.
 */
function showNotification(title, options) {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'notify', title, options });
  } else if ('Notification' in window) {
    new Notification(title, options);
  }
}

async function handleEnableNotifications() {
  if (!('Notification' in window)) {
    alert('Tento prohlížeč nepodporuje notifikace.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('Notifikace nejsou povoleny.');
    return;
  }
  try {
    await subscribeForPush();
    alert('Notifikace byly povoleny.');
  } catch (err) {
    console.error('Nepodařilo se zaregistrovat push:', err);
  }
}

async function subscribeForPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    await sendSubscriptionData(sub);
  } catch (err) {
    console.error('Chyba při vytváření push subscription:', err);
  }
}

async function sendSubscriptionData(sub) {
  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub,
        locations,
        notificationTime: settings.notificationTime || '07:00'
      })
    });
  } catch (err) {
    console.error('Chyba při odesílání dat na server:', err);
  }
}

// Požádá uživatele o povolení notifikací, pokud ještě nebylo uděleno
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}
if (typeof module !== "undefined") {
  module.exports = { getWeatherIcon };
}
