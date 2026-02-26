document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  initApp();
});

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.error('Chyba SW', err);
    });
  }
}

const DEFAULT_CITIES = [{ name: 'Roudnice nad Labem' }];
const LOCATIONS_KEY = 'weatherAppLocations';
let locations = [];

async function initApp() {
  locations = await loadLocations();
  await updateAllLocations();
  setupSearch();
}

async function loadLocations() {
  const stored = localStorage.getItem(LOCATIONS_KEY);
  let locs = [...DEFAULT_CITIES];

  if (stored) {
    try {
      locs = JSON.parse(stored);
    } catch (_error) {
      locs = [...DEFAULT_CITIES];
    }
  }

  for (const loc of locs) {
    if (!loc.latitude || !loc.longitude) {
      const geo = await geocodeCity(loc.name);
      if (geo) {
        loc.latitude = geo.latitude;
        loc.longitude = geo.longitude;
      }
    }
  }

  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locs));
  return locs;
}

function saveLocations() {
  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locations));
}

function setupSearch() {
  const searchInput = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');
  let searchTimeout;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    clearTimeout(searchTimeout);

    if (query.length < 2) {
      resultsContainer.innerHTML = '';
      return;
    }

    searchTimeout = setTimeout(async () => {
      const results = await geocodeSearch(query);
      resultsContainer.innerHTML = '';

      results.forEach((res) => {
        const button = document.createElement('button');
        button.className = 'search-result-item';
        button.type = 'button';
        const region = [res.admin1, res.country].filter(Boolean).join(', ');
        button.textContent = `${res.name}${region ? `, ${region}` : ''}`;

        button.addEventListener('click', async () => {
          const exists = locations.some(
            (l) => l.name.toLowerCase() === res.name.toLowerCase() && l.latitude === res.latitude
          );

          if (!exists) {
            locations.unshift({
              name: res.name,
              latitude: res.latitude,
              longitude: res.longitude
            });
            saveLocations();
            await updateAllLocations();
          }

          searchInput.value = '';
          resultsContainer.innerHTML = '';
        });

        resultsContainer.appendChild(button);
      });
    }, 250);
  });
}

async function geocodeSearch(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=cs`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    return data.results || [];
  } catch (error) {
    console.error('Chyba při vyhledávání města:', error);
    return [];
  }
}

async function geocodeCity(name) {
  const results = await geocodeSearch(name);
  return results[0];
}

async function updateAllLocations() {
  const container = document.getElementById('locations-container');
  container.innerHTML = '';

  for (const loc of locations) {
    if (!loc.latitude || !loc.longitude) continue;
    const weather = await fetchWeather(loc);
    container.appendChild(createLocationCard(loc, weather));
  }
}

async function fetchWeather(loc) {
  const { latitude, longitude } = loc;
  const url = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weathercode,relative_humidity_2m,wind_speed_10m&forecast_hours=48&model=icon_d2&timezone=Europe%2FPrague`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();

    const time = data.hourly?.time || [];
    const temperatures = data.hourly?.temperature_2m || [];
    const apparent = data.hourly?.apparent_temperature || [];
    const precipProb = data.hourly?.precipitation_probability || [];
    const weathercode = data.hourly?.weathercode || [];
    const humidity = data.hourly?.relative_humidity_2m || [];
    const wind = data.hourly?.wind_speed_10m || [];

    const hourly = time.slice(0, 48).map((hour, index) => ({
      time: hour,
      temp: temperatures[index],
      apparent: apparent[index],
      precipProb: precipProb[index] || 0,
      weatherCode: weathercode[index],
      humidity: humidity[index],
      wind: wind[index]
    }));

    const current = hourly[0] || null;
    const daily = buildDailyForecast(hourly);

    return { current, hourly, daily };
  } catch (error) {
    console.error('Chyba při načítání předpovědi:', error);
    return { current: null, hourly: [], daily: [] };
  }
}

function buildDailyForecast(hourly) {
  const grouped = {};

  hourly.forEach((hour) => {
    const date = hour.time.split('T')[0];
    if (!grouped[date]) {
      grouped[date] = {
        temps: [],
        codes: [],
        precip: []
      };
    }

    grouped[date].temps.push(hour.temp);
    grouped[date].codes.push(hour.weatherCode);
    grouped[date].precip.push(hour.precipProb);
  });

  return Object.keys(grouped)
    .sort()
    .slice(0, 2)
    .map((date) => {
      const info = grouped[date];
      const tempMax = Math.max(...info.temps);
      const tempMin = Math.min(...info.temps);
      const avgPrecip = Math.round(info.precip.reduce((sum, val) => sum + val, 0) / info.precip.length);

      const codeCounts = {};
      info.codes.forEach((code) => {
        codeCounts[code] = (codeCounts[code] || 0) + 1;
      });
      const weatherCode = Number(
        Object.keys(codeCounts).reduce((a, b) => (codeCounts[a] > codeCounts[b] ? a : b), 0)
      );

      return { date, tempMax, tempMin, avgPrecip, weatherCode };
    });
}

function createLocationCard(loc, weather) {
  const card = document.createElement('article');
  card.className = 'location-card';

  const current = weather.current;
  const today = weather.daily[0];

  card.innerHTML = `
    <header class="hero">
      <div>
        <h2>${loc.name}</h2>
        <p class="condition">${current ? describeWeather(current.weatherCode) : 'Data nejsou dostupná'}</p>
      </div>
      <button class="remove-btn" type="button" title="Odstranit město">×</button>
    </header>
    <section class="hero-temp">
      <div class="temperature">${current ? `${Math.round(current.temp)}°` : '—'}</div>
      <div class="meta">
        <span class="meta-item">${current ? `Pocitově ${Math.round(current.apparent)}°` : ''}</span>
        <span class="meta-item">${today ? `H: ${Math.round(today.tempMax)}°  L: ${Math.round(today.tempMin)}°` : ''}</span>
      </div>
      <div class="weather-emoji">${current ? getWeatherIcon(current.weatherCode) : '☁️'}</div>
    </section>
    <section class="panel">
      <h3>Nejbližších 24h (z 48h modelu)</h3>
      <div class="hourly-strip"></div>
    </section>
    <section class="panel">
      <h3>Denní přehled (2 dny)</h3>
      <div class="daily-list"></div>
    </section>
    <section class="panel details-grid">
      <div><span>Srážky</span><strong>${current ? `${current.precipProb}%` : '—'}</strong></div>
      <div><span>Vlhkost</span><strong>${current ? `${current.humidity}%` : '—'}</strong></div>
      <div><span>Vítr</span><strong>${current ? `${Math.round(current.wind)} km/h` : '—'}</strong></div>
      <div><span>Model</span><strong>ICON D2</strong></div>
    </section>
  `;

  card.querySelector('.remove-btn').addEventListener('click', () => {
    locations = locations.filter((item) => item !== loc);
    saveLocations();
    updateAllLocations();
  });

  const hourlyStrip = card.querySelector('.hourly-strip');
  weather.hourly.slice(0, 24).forEach((hour) => {
    const slot = document.createElement('div');
    slot.className = 'hour-item';
    slot.innerHTML = `
      <span class="hour-time">${formatHour(hour.time)}</span>
      <span class="hour-icon">${getWeatherIcon(hour.weatherCode)}</span>
      <span class="hour-temp">${Math.round(hour.temp)}°</span>
      <span class="hour-rain">${hour.precipProb}%</span>
    `;
    hourlyStrip.appendChild(slot);
  });

  const minTemp = Math.min(...weather.daily.map((day) => day.tempMin));
  const maxTemp = Math.max(...weather.daily.map((day) => day.tempMax));
  const dailyList = card.querySelector('.daily-list');
  weather.daily.forEach((day, index) => {
    const row = document.createElement('div');
    row.className = 'daily-row';
    row.innerHTML = `
      <span class="day-name">${index === 0 ? 'Dnes' : formatDay(day.date)}</span>
      <span class="day-icon">${getWeatherIcon(day.weatherCode)}</span>
      <span class="day-rain">${day.avgPrecip}%</span>
      <span class="day-min">${Math.round(day.tempMin)}°</span>
      <div class="temp-range">${buildRange(day.tempMin, day.tempMax, minTemp, maxTemp)}</div>
      <span class="day-max">${Math.round(day.tempMax)}°</span>
    `;
    dailyList.appendChild(row);
  });

  return card;
}

function buildRange(min, max, globalMin, globalMax) {
  const total = Math.max(globalMax - globalMin, 1);
  const left = ((min - globalMin) / total) * 100;
  const width = ((max - min) / total) * 100;

  return `
    <span class="range-track"></span>
    <span class="range-fill" style="left:${left}%;width:${Math.max(width, 8)}%"></span>
  `;
}

function formatHour(hour) {
  const date = new Date(hour);
  return date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  return date.toLocaleDateString('cs-CZ', { weekday: 'short' }).replace('.', '');
}

function describeWeather(code) {
  if (code === 0) return 'Jasno';
  if ([1, 2, 3].includes(code)) return 'Polojasno až oblačno';
  if ([45, 48].includes(code)) return 'Mlha';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Mrholení';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Déšť';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Sněžení';
  if ([95, 96, 99].includes(code)) return 'Bouřky';
  return 'Proměnlivo';
}

function getWeatherIcon(code) {
  if (code === 0) return '☀️';
  if ([1, 2, 3].includes(code)) return '🌤️';
  if ([45, 48].includes(code)) return '🌫️';
  if ([51, 53, 55].includes(code)) return '🌦️';
  if ([56, 57].includes(code)) return '🌧️';
  if ([61, 63, 65, 80, 81, 82].includes(code)) return '🌧️';
  if ([66, 67].includes(code)) return '🌧️';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '❄️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '☁️';
}

if (typeof module !== 'undefined') {
  module.exports = { getWeatherIcon };
}
