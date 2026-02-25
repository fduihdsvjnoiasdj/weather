/*
 * Hlavní skript pro PWA aplikaci Předpověď počasí.
 * Zajišťuje načtení dat z API Open‑Meteo, vyhledávání měst pomocí geokódovacího API,
 * zobrazování předpovědí v českém jazyce.
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
// Globální proměnné
let locations = [];

async function initApp() {
  // Načíst uložená města nebo použít výchozí
  locations = await loadLocations();
  await updateAllLocations();

  // Nastavit hledání měst
  setupSearch();

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
 * Načte počasí pro dané místo z API Open‑Meteo. Využívá model ICON‑D2
 * (48 hodin) a vytvoří denní souhrny.
 */
async function fetchWeather(loc) {
  const { latitude, longitude } = loc;
  try {
    const d2Url = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation,precipitation_probability,weathercode,shortwave_radiation&forecast_hours=48&model=icon_d2&timezone=Europe%2FPrague`;
    const d2Resp = await fetch(d2Url);
    const d2Data = await d2Resp.json();

    const time = d2Data.hourly?.time || [];
    const temps = d2Data.hourly?.temperature_2m || [];
    const precipitation = d2Data.hourly?.precipitation || [];
    const precipitationProb = d2Data.hourly?.precipitation_probability || [];
    const codes = d2Data.hourly?.weathercode || [];
    const shortwave = d2Data.hourly?.shortwave_radiation || [];
    // Vytvořit denní souhrny (2 dny)
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
      .slice(0, 2)
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
    const limit = Math.min(time.length, 48); // první 48 hodin
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

  const label = document.createElement('div');
  label.className = 'chart-label';
  const first = weather.hourly.time[0];
  if (first) {
    const d = new Date(first);
    label.textContent = `Dnes (${d.toLocaleDateString('cs-CZ')})`;
  } else {
    label.textContent = 'Dnes';
  }
  card.appendChild(label);

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
    if (segments[day.date]) {
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

  // necháme trochu místa na popisek srážek
  const leftMargin = 30;
  const stepX = (width - leftMargin) / count;

  // osa x a y
  ctx.strokeStyle = '#888';
  ctx.beginPath();
  ctx.moveTo(leftMargin, height - 20);
  ctx.lineTo(width, height - 20);
  ctx.moveTo(leftMargin, height - 20);
  ctx.lineTo(leftMargin, 10);
  ctx.stroke();

  // popisek jednotky srážek
  ctx.save();
  ctx.fillStyle = '#333';
  ctx.font = '10px sans-serif';
  ctx.translate(10, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('mm', 0, 0);
  ctx.restore();

  // labels hours every 6h
  ctx.fillStyle = '#333';
  ctx.font = '10px sans-serif';
  for (let i = 0; i < count; i += 6) {
    const d = new Date(hourly.time[i]);
    const label = d.getHours().toString();
    ctx.fillText(label, leftMargin + i * stepX + stepX / 2 - 5, height - 5);
  }

  // precipitation line
  ctx.strokeStyle = '#2196f3';
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const y = height - 20 - (hourly.precipitation[i] / maxPrecip) * (height - 40);
    const x = leftMargin + i * stepX + stepX / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // sunshine line
  ctx.strokeStyle = '#ffd600';
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const y = height - 20 - (hourly.sunshine[i] / maxSun) * (height - 40);
    const x = leftMargin + i * stepX + stepX / 2;
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

if (typeof module !== "undefined") {
  module.exports = { getWeatherIcon };
}
