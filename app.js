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
let weatherCache = new Map();
let currentPage = 0;

async function initApp() {
  locations = await loadLocations();
  await updateAllLocations();
  setupSearch();
  setupBottomBar();
  setupPageDots();
}

function getGPSLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  });
}

async function reverseGeocode(latitude, longitude) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=cs&zoom=10`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'PocasiPWA/1.0' } });
    const data = await resp.json();
    return data.address?.city || data.address?.town || data.address?.village || data.address?.municipality || 'Moje poloha';
  } catch {
    return 'Moje poloha';
  }
}

async function loadLocations() {
  const stored = localStorage.getItem(LOCATIONS_KEY);
  let locs;

  if (stored) {
    try {
      locs = JSON.parse(stored);
    } catch (_error) {
      locs = [...DEFAULT_CITIES];
    }
  } else {
    const gpsCoords = await getGPSLocation();
    if (gpsCoords) {
      const cityName = await reverseGeocode(gpsCoords.latitude, gpsCoords.longitude);
      locs = [{
        name: cityName,
        latitude: gpsCoords.latitude,
        longitude: gpsCoords.longitude,
        isGPS: true
      }];
    } else {
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

  const gpsLoc = locs.find((l) => l.isGPS);
  if (gpsLoc) {
    const freshCoords = await getGPSLocation();
    if (freshCoords) {
      gpsLoc.latitude = freshCoords.latitude;
      gpsLoc.longitude = freshCoords.longitude;
    }
  }

  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locs));
  return locs;
}

function saveLocations() {
  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locations));
}

/* ---- Search ---- */

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
          }

          searchInput.value = '';
          resultsContainer.innerHTML = '';
          closeSearchOverlay();
          currentPage = 0;
          await updateAllLocations();
        });

        resultsContainer.appendChild(button);
      });
    }, 250);
  });
}

function setupBottomBar() {
  document.getElementById('btn-list').addEventListener('click', openSearchOverlay);
}

function openSearchOverlay() {
  const overlay = document.getElementById('search-overlay');
  overlay.classList.remove('hidden');
  renderCityList();
  setTimeout(() => document.getElementById('search-input').focus(), 100);
}

function closeSearchOverlay() {
  const overlay = document.getElementById('search-overlay');
  overlay.classList.add('hidden');
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
}

function renderCityList() {
  const container = document.getElementById('city-list');
  container.innerHTML = '';

  locations.forEach((loc, index) => {
    const cached = weatherCache.get(locKey(loc));
    const card = document.createElement('div');
    card.className = 'city-list-card';

    const current = cached?.current;
    const today = cached?.daily?.[0];

    const now = new Date();
    const timeStr = now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
      <div class="city-list-left">
        <div class="city-list-name">${loc.isGPS ? '<svg class="gps-indicator" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ' : ''}${loc.name}</div>
        <div class="city-list-time">${timeStr}</div>
        <div class="city-list-condition">${current ? describeWeather(current.weatherCode) : ''}</div>
      </div>
      <div class="city-list-right">
        <div class="city-list-temp">${current ? `${Math.round(current.temp)}°` : '—'}</div>
        <div class="city-list-highlow">${today ? `H:${Math.round(today.tempMax)}° L:${Math.round(today.tempMin)}°` : ''}</div>
      </div>
      <div class="city-list-actions">
        <button class="city-list-move city-list-move-up" type="button" title="Posunout nahoru" ${index === 0 ? 'disabled' : ''}>&#9650;</button>
        <button class="city-list-move city-list-move-down" type="button" title="Posunout dolů" ${index === locations.length - 1 ? 'disabled' : ''}>&#9660;</button>
        <button class="city-list-remove" type="button" title="Odstranit">×</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.city-list-actions')) return;
      closeSearchOverlay();
      scrollToPage(index);
    });

    card.querySelector('.city-list-move-up').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (index === 0) return;
      [locations[index - 1], locations[index]] = [locations[index], locations[index - 1]];
      saveLocations();
      if (currentPage === index) currentPage = index - 1;
      else if (currentPage === index - 1) currentPage = index;
      await updateAllLocations();
      renderCityList();
    });

    card.querySelector('.city-list-move-down').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (index === locations.length - 1) return;
      [locations[index], locations[index + 1]] = [locations[index + 1], locations[index]];
      saveLocations();
      if (currentPage === index) currentPage = index + 1;
      else if (currentPage === index + 1) currentPage = index;
      await updateAllLocations();
      renderCityList();
    });

    card.querySelector('.city-list-remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      locations = locations.filter((item) => item !== loc);
      saveLocations();
      weatherCache.delete(locKey(loc));
      if (currentPage >= locations.length) currentPage = Math.max(0, locations.length - 1);
      await updateAllLocations();
      renderCityList();
    });

    container.appendChild(card);
  });
}

/* ---- Page Dots ---- */

function setupPageDots() {
  const pagesEl = document.getElementById('weather-pages');
  pagesEl.addEventListener('scroll', () => {
    const pageWidth = pagesEl.offsetWidth;
    const newPage = Math.round(pagesEl.scrollLeft / pageWidth);
    if (newPage !== currentPage) {
      currentPage = newPage;
      updateDots();
    }
  });
}

function renderDots() {
  const container = document.getElementById('page-dots');
  container.innerHTML = '';

  locations.forEach((loc, i) => {
    const dot = document.createElement('div');
    dot.className = `page-dot${i === currentPage ? ' active' : ''}${loc.isGPS ? ' loc-dot' : ''}`;
    dot.addEventListener('click', () => scrollToPage(i));
    container.appendChild(dot);
  });
}

function updateDots() {
  const dots = document.querySelectorAll('.page-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === currentPage);
  });
}

function scrollToPage(index) {
  const pagesEl = document.getElementById('weather-pages');
  pagesEl.scrollTo({ left: index * pagesEl.offsetWidth, behavior: 'smooth' });
  currentPage = index;
  updateDots();
}

/* ---- API ---- */

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

async function fetchWeather(loc) {
  const { latitude, longitude } = loc;
  const params = 'hourly=temperature_2m,apparent_temperature,precipitation_probability,weathercode,relative_humidity_2m,windspeed_10m&timezone=Europe%2FPrague';
  const d2Url = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&${params}&forecast_hours=48&model=icon_d2`;
  const euUrl = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&${params}&forecast_hours=120&model=icon_eu`;

  try {
    const [d2Resp, euResp] = await Promise.all([fetch(d2Url), fetch(euUrl)]);
    const [d2Data, euData] = await Promise.all([d2Resp.json(), euResp.json()]);

    const mapHourly = (data, count) => {
      const time = data.hourly?.time || [];
      return time.slice(0, count).map((hour, i) => ({
        time: hour,
        temp: data.hourly.temperature_2m[i],
        apparent: data.hourly.apparent_temperature[i],
        precipProb: data.hourly.precipitation_probability[i] || 0,
        weatherCode: data.hourly.weathercode[i],
        humidity: data.hourly.relative_humidity_2m[i],
        wind: data.hourly.windspeed_10m[i]
      }));
    };

    const d2Hourly = mapHourly(d2Data, 48);

    const d2EndTime = d2Hourly.length > 0 ? d2Hourly[d2Hourly.length - 1].time : null;
    const euTime = euData.hourly?.time || [];
    const euHourly = [];
    for (let i = 0; i < euTime.length; i++) {
      if (d2EndTime && euTime[i] <= d2EndTime) continue;
      euHourly.push({
        time: euTime[i],
        temp: euData.hourly.temperature_2m[i],
        apparent: euData.hourly.apparent_temperature[i],
        precipProb: euData.hourly.precipitation_probability[i] || 0,
        weatherCode: euData.hourly.weathercode[i],
        humidity: euData.hourly.relative_humidity_2m[i],
        wind: euData.hourly.windspeed_10m[i]
      });
    }

    const allHourly = [...d2Hourly, ...euHourly];
    const current = d2Hourly[0] || null;
    const daily = buildDailyForecast(allHourly);

    return { current, hourly: d2Hourly, daily };
  } catch (error) {
    console.error('Chyba při načítání předpovědi:', error);
    return { current: null, hourly: [], daily: [] };
  }
}

function locKey(loc) {
  return `${loc.latitude},${loc.longitude}`;
}

/* ---- Update All ---- */

async function updateAllLocations() {
  const pagesEl = document.getElementById('weather-pages');
  pagesEl.innerHTML = '';

  if (locations.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'city-page empty-state';
    empty.innerHTML = '<div>🌤️</div><p>Žádná města.<br>Klepněte na ☰ a přidejte město.</p>';
    pagesEl.appendChild(empty);
    renderDots();
    return;
  }

  for (const loc of locations) {
    if (!loc.latitude || !loc.longitude) continue;
    const weather = await fetchWeather(loc);
    weatherCache.set(locKey(loc), weather);
    pagesEl.appendChild(createCityPage(loc, weather));
  }

  renderDots();
  scrollToPage(currentPage);
}

/* ---- Build UI ---- */

function createCityPage(loc, weather) {
  const page = document.createElement('div');
  page.className = 'city-page';

  const current = weather.current;
  const today = weather.daily[0];

  // Add weather-based background class
  page.classList.add(getWeatherBgClass(current?.weatherCode));

  // City header
  const header = document.createElement('div');
  header.className = 'city-header';
  header.innerHTML = `
    <div class="city-name">${loc.isGPS ? '<svg class="gps-header-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ' : ''}${loc.name}</div>
    <div class="city-temp">${current ? `${Math.round(current.temp)}°` : '—'}</div>
    <div class="city-condition">${current ? describeWeather(current.weatherCode) : 'Data nejsou dostupná'}</div>
    <div class="city-highlow">${today ? `H:${Math.round(today.tempMax)}°  L:${Math.round(today.tempMin)}°` : ''}</div>
  `;
  page.appendChild(header);

  // Hourly panel
  const hourlyPanel = document.createElement('div');
  hourlyPanel.className = 'glass-panel';
  hourlyPanel.innerHTML = `
    <div class="panel-label">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      48hodinová předpověď
    </div>
    <div class="panel-separator"></div>
    <div class="hourly-strip"></div>
  `;

  const strip = hourlyPanel.querySelector('.hourly-strip');
  weather.hourly.forEach((hour, i) => {
    const slot = document.createElement('div');
    slot.className = 'hour-item';
    const timeLabel = i === 0 ? 'Teď' : formatHour(hour.time);
    const precipHtml = hour.precipProb > 0 ? `<span class="hour-precip">${hour.precipProb}%</span>` : '<span class="hour-precip"></span>';
    slot.innerHTML = `
      <span class="hour-time">${timeLabel}</span>
      <span class="hour-icon">${getWeatherIcon(hour.weatherCode)}</span>
      ${precipHtml}
      <span class="hour-temp">${Math.round(hour.temp)}°</span>
    `;
    strip.appendChild(slot);
  });
  page.appendChild(hourlyPanel);

  // Daily panel
  const dailyPanel = document.createElement('div');
  dailyPanel.className = 'glass-panel';
  dailyPanel.innerHTML = `
    <div class="panel-label">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      Předpověď na 5 dní
    </div>
    <div class="daily-list"></div>
  `;

  const minTemp = Math.min(...weather.daily.map((d) => d.tempMin));
  const maxTemp = Math.max(...weather.daily.map((d) => d.tempMax));
  const dailyList = dailyPanel.querySelector('.daily-list');

  weather.daily.forEach((day, index) => {
    const row = document.createElement('div');
    row.className = 'daily-row';
    row.innerHTML = `
      <span class="day-name">${index === 0 ? 'Dnes' : formatDay(day.date)}</span>
      <span class="day-icon">${getWeatherIcon(day.weatherCode)}</span>
      <span class="day-min">${Math.round(day.tempMin)}°</span>
      <div class="temp-range">${buildRange(day.tempMin, day.tempMax, minTemp, maxTemp)}</div>
      <span class="day-max">${Math.round(day.tempMax)}°</span>
    `;
    dailyList.appendChild(row);
  });
  page.appendChild(dailyPanel);

  // Details grid (Apple Weather style cards)
  const grid = document.createElement('div');
  grid.className = 'details-grid';

  // Feels Like
  grid.innerHTML += `
    <div class="detail-card">
      <div class="detail-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>
        Pocitově
      </div>
      <div class="detail-value">${current ? `${Math.round(current.apparent)}°` : '—'}</div>
      <div class="detail-note">${current ? getFeelsLikeNote(current.temp, current.apparent) : ''}</div>
    </div>
  `;

  // Humidity
  grid.innerHTML += `
    <div class="detail-card">
      <div class="detail-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
        Vlhkost
      </div>
      <div class="detail-value">${current ? `${current.humidity}%` : '—'}</div>
      <div class="detail-note">${current ? getHumidityNote(current.humidity) : ''}</div>
    </div>
  `;

  // Wind
  grid.innerHTML += `
    <div class="detail-card">
      <div class="detail-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>
        Vítr
      </div>
      <div class="detail-value">${current ? `${Math.round(current.wind)}` : '—'}<span style="font-size:0.9rem;font-weight:400"> km/h</span></div>
    </div>
  `;

  // Precipitation
  grid.innerHTML += `
    <div class="detail-card">
      <div class="detail-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="16" y1="13" x2="16" y2="21"/><line x1="8" y1="13" x2="8" y2="21"/><line x1="12" y1="15" x2="12" y2="23"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/></svg>
        Srážky
      </div>
      <div class="detail-value">${current ? `${current.precipProb}%` : '—'}</div>
      <div class="detail-note">Pravděpodobnost srážek</div>
    </div>
  `;

  page.appendChild(grid);

  // Model info footer
  const footer = document.createElement('div');
  footer.className = 'glass-panel';
  footer.style.textAlign = 'center';
  footer.style.marginBottom = '20px';
  footer.innerHTML = `
    <div style="font-size:0.78rem;color:var(--text-secondary)">
      ICON D2 + ICON EU · Open-Meteo
    </div>
  `;
  page.appendChild(footer);

  return page;
}

/* ---- Helpers ---- */

function buildRange(min, max, globalMin, globalMax) {
  const total = Math.max(globalMax - globalMin, 1);
  const left = ((min - globalMin) / total) * 100;
  const width = ((max - min) / total) * 100;

  return `<span class="range-fill" style="left:${left}%;width:${Math.max(width, 8)}%"></span>`;
}

function buildDailyForecast(hourly) {
  const grouped = {};

  hourly.forEach((hour) => {
    const date = hour.time.split('T')[0];
    if (!grouped[date]) {
      grouped[date] = { temps: [], codes: [], precip: [] };
    }

    grouped[date].temps.push(hour.temp);
    grouped[date].codes.push(hour.weatherCode);
    grouped[date].precip.push(hour.precipProb);
  });

  return Object.keys(grouped)
    .sort()
    .slice(0, 5)
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

function getWeatherBgClass(code) {
  if (code === undefined || code === null) return 'weather-cloudy';

  // Check if it's nighttime (rough heuristic)
  const hour = new Date().getHours();
  const isNight = hour < 6 || hour > 20;

  if (isNight) return 'weather-night';
  if (code === 0) return 'weather-clear';
  if ([1, 2, 3].includes(code)) return 'weather-clear';
  if ([45, 48].includes(code)) return 'weather-fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'weather-rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'weather-snow';
  if ([95, 96, 99].includes(code)) return 'weather-storm';
  return 'weather-cloudy';
}

function getFeelsLikeNote(actual, apparent) {
  const diff = Math.round(apparent) - Math.round(actual);
  if (Math.abs(diff) <= 1) return 'Podobné jako skutečná teplota.';
  if (diff < 0) return 'Vítr snižuje pocitovou teplotu.';
  return 'Vlhkost zvyšuje pocitovou teplotu.';
}

function getHumidityNote(humidity) {
  if (humidity >= 70) return 'Vzduch je vlhký.';
  if (humidity <= 30) return 'Vzduch je suchý.';
  return 'Vlhkost je příjemná.';
}

if (typeof module !== 'undefined') {
  module.exports = { getWeatherIcon };
}
