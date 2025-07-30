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

// Registrace service workeru pro PWA funkce
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('service-worker.js')
      .then(() => {
        // Service worker úspěšně zaregistrován
      })
      .catch((err) => {
        console.error('ServiceWorker registration failed:', err);
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
      const dailyForecast = await fetchWeather(loc);
      const card = createLocationCard(loc, dailyForecast);
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
    const d2Url = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation,precipitation_probability,weathercode&forecast_hours=48&model=icon_d2&timezone=Europe%2FPrague`;
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
        // Zvolit nejčastější kód počasí pro daný den
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
    return dailyArray;
  } catch (error) {
    console.error('Chyba při načítání předpovědi:', error);
    return [];
  }
}

/**
 * Vytvoří DOM kartu pro město a jeho předpověď.
 */
function createLocationCard(loc, dailyForecast) {
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

  // Tělo předpovědi
  const grid = document.createElement('div');
  grid.className = 'forecast-grid';
  dailyForecast.forEach((day) => {
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
    // Ikona koupání nebo deště
    if (day.tempMax >= 25 && day.precipitation < 1) {
      const swim = document.createElement('div');
      swim.textContent = '🏖️';
      dayDiv.appendChild(swim);
    } else if (day.precipitation >= 1 || day.precipProb > 50) {
      const rain = document.createElement('div');
      rain.textContent = '🌧️';
      dayDiv.appendChild(rain);
    }
    grid.appendChild(dayDiv);
  });
  card.appendChild(grid);
  return card;
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

/**
 * Naplánuje periodickou kontrolu pro odesílání denních notifikací. Každou
 * minutu zkontroluje, zda nastal nastavený čas. Pokud ano, zavolá funkci
 * checkForNotification() pro všechny uložené lokace.
 */
function scheduleDailyNotifications() {
  // Zrušit případný existující interval
  if (notificationIntervalId) {
    clearInterval(notificationIntervalId);
  }
  const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  const targetTime = settings.notificationTime || '07:00';

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
      // Načti denní předpověď pro nejbližší den
      const daily = await fetchWeather(loc);
      if (daily && daily.length > 0) {
        const today = daily[0];
        let title = '';
        let body = '';
        let icon = '';
        if (today.tempMax >= 25 && today.precipitation < 1) {
          title = `Koupací den v ${loc.name}!`;
          body = `Očekává se slunečno a max ${Math.round(today.tempMax)} °C. Užijte si den!`;
          icon = '🏖️';
        } else if (today.precipitation >= 1 || today.precipProb > 50) {
          title = `Bude pršet v ${loc.name}`;
          body = `Očekávané srážky ${today.precipitation.toFixed(1)} mm. Nezapomeňte na deštník!`;
          icon = '🌧️';
        }
        if (title) {
          showNotification(title, { body: body, badge: 'icons/icon-192.png', icon: 'icons/icon-192.png' });
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
if (typeof module !== "undefined") {
  module.exports = { getWeatherIcon };
}
