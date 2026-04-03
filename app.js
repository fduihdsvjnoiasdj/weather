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

    const bgClass = current ? getWeatherBgClass(current.weatherCode) : 'weather-cloudy';
    card.classList.add(bgClass);
    card.innerHTML = `
      <div class="city-list-left">
        <div class="city-list-name">${loc.isGPS ? '📍 ' : ''}${loc.name}</div>
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
  const hourlyParams = [
    'temperature_2m', 'apparent_temperature', 'precipitation_probability',
    'weathercode', 'relative_humidity_2m', 'windspeed_10m', 'winddirection_10m',
    'windgusts_10m', 'surface_pressure', 'precipitation', 'uv_index', 'visibility'
  ].join(',');
  const params = `hourly=${hourlyParams}&timezone=Europe%2FPrague`;
  const dailyParams = 'daily=sunrise,sunset,uv_index_max&timezone=Europe%2FPrague';

  const d2Url = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&${params}&forecast_hours=48&model=icon_d2`;
  const euUrl = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&${params}&forecast_hours=168&model=icon_eu`;
  const dailyUrl = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&${dailyParams}&forecast_days=10`;

  try {
    const [d2Resp, euResp, dailyResp] = await Promise.all([fetch(d2Url), fetch(euUrl), fetch(dailyUrl)]);
    const [d2Data, euData, dailyData] = await Promise.all([d2Resp.json(), euResp.json(), dailyResp.json()]);

    const mapHourly = (data, count) => {
      const time = data.hourly?.time || [];
      return time.slice(0, count).map((hour, i) => ({
        time: hour,
        temp: data.hourly.temperature_2m[i],
        apparent: data.hourly.apparent_temperature[i],
        precipProb: data.hourly.precipitation_probability[i] || 0,
        weatherCode: data.hourly.weathercode[i],
        humidity: data.hourly.relative_humidity_2m[i],
        wind: data.hourly.windspeed_10m[i],
        windDirection: data.hourly.winddirection_10m?.[i] || 0,
        windGusts: data.hourly.windgusts_10m?.[i] || 0,
        pressure: data.hourly.surface_pressure?.[i] || null,
        precipitation: data.hourly.precipitation?.[i] || 0,
        uvIndex: data.hourly.uv_index?.[i] || 0,
        visibility: data.hourly.visibility?.[i] || null
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
        wind: euData.hourly.windspeed_10m[i],
        windDirection: euData.hourly.winddirection_10m?.[i] || 0,
        windGusts: euData.hourly.windgusts_10m?.[i] || 0,
        pressure: euData.hourly.surface_pressure?.[i] || null,
        precipitation: euData.hourly.precipitation?.[i] || 0,
        uvIndex: euData.hourly.uv_index?.[i] || 0,
        visibility: euData.hourly.visibility?.[i] || null
      });
    }

    const allHourly = [...d2Hourly, ...euHourly];
    const current = d2Hourly[0] || null;
    const daily = buildDailyForecast(allHourly);

    // Merge sunrise/sunset from daily API
    const sunData = dailyData.daily || {};
    daily.forEach((day, i) => {
      if (sunData.sunrise?.[i]) day.sunrise = sunData.sunrise[i];
      if (sunData.sunset?.[i]) day.sunset = sunData.sunset[i];
      if (sunData.uv_index_max?.[i] != null) day.uvMax = sunData.uv_index_max[i];
    });

    return { current, hourly: d2Hourly, allHourly, daily };
  } catch (error) {
    console.error('Chyba při načítání předpovědi:', error);
    return { current: null, hourly: [], allHourly: [], daily: [] };
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

  page.classList.add(getWeatherBgClass(current?.weatherCode));

  // City header
  const header = document.createElement('div');
  header.className = 'city-header';
  header.innerHTML = `
    <div class="city-name">${loc.isGPS ? '<span class="gps-badge">📍 </span>' : ''}${loc.name}</div>
    <div class="city-temp">${current ? `${Math.round(current.temp)}°` : '—'}</div>
    <div class="city-condition">${current ? describeWeather(current.weatherCode) : 'Data nejsou dostupná'}</div>
    <div class="city-highlow">${today ? `H:${Math.round(today.tempMax)}°  L:${Math.round(today.tempMin)}°` : ''}</div>
  `;
  page.appendChild(header);

  // Hourly forecast panel
  const hourlyPanel = document.createElement('div');
  hourlyPanel.className = 'glass-panel';
  const summary = getHourlySummary(weather.hourly);
  hourlyPanel.innerHTML = `
    <div class="panel-label">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      Hodinová předpověď
    </div>
    <div class="panel-summary">${summary}</div>
    <div class="panel-separator"></div>
    <div class="hourly-strip"></div>
  `;

  const strip = hourlyPanel.querySelector('.hourly-strip');
  weather.hourly.forEach((hour, i) => {
    const slot = document.createElement('div');
    slot.className = 'hour-item';
    const timeLabel = i === 0 ? 'Teď' : formatHour(hour.time);
    const precipHtml = hour.precipProb > 0 ? `<span class="hour-precip">${hour.precipProb}%</span>` : '<span class="hour-precip-spacer"></span>';
    slot.innerHTML = `
      <span class="hour-time">${timeLabel}</span>
      <span class="hour-icon">${getWeatherIcon(hour.weatherCode, hour.time)}</span>
      ${precipHtml}
      <span class="hour-temp">${Math.round(hour.temp)}°</span>
    `;
    strip.appendChild(slot);
  });
  page.appendChild(hourlyPanel);

  // Daily forecast panel (10-day)
  const dailyPanel = document.createElement('div');
  dailyPanel.className = 'glass-panel';
  const dayCount = weather.daily.length;
  dailyPanel.innerHTML = `
    <div class="panel-label">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      Předpověď na ${dayCount} dní
    </div>
    <div class="daily-list"></div>
  `;

  const globalMin = Math.min(...weather.daily.map((d) => d.tempMin));
  const globalMax = Math.max(...weather.daily.map((d) => d.tempMax));
  const dailyList = dailyPanel.querySelector('.daily-list');
  const currentTemp = current ? current.temp : null;

  weather.daily.forEach((day, index) => {
    const row = document.createElement('div');
    row.className = 'daily-row';
    const gradient = buildTempGradient(day.tempMin, day.tempMax);
    const range = globalMax - globalMin || 1;
    const left = ((day.tempMin - globalMin) / range) * 100;
    const width = Math.max(((day.tempMax - day.tempMin) / range) * 100, 8);

    let dotHtml = '';
    if (index === 0 && currentTemp !== null) {
      const dotPos = ((currentTemp - day.tempMin) / (day.tempMax - day.tempMin || 1)) * 100;
      const clampedDot = Math.max(0, Math.min(100, dotPos));
      dotHtml = `<span class="temp-dot" style="left:${clampedDot}%"></span>`;
    }

    row.innerHTML = `
      <span class="day-name">${index === 0 ? 'Dnes' : formatDay(day.date)}</span>
      <span class="day-icon">${getWeatherIcon(day.weatherCode)}</span>
      <span class="day-min">${Math.round(day.tempMin)}°</span>
      <div class="temp-range"><span class="range-fill" style="left:${left}%;width:${width}%;background:${gradient}">${dotHtml}</span></div>
      <span class="day-max">${Math.round(day.tempMax)}°</span>
    `;
    dailyList.appendChild(row);
  });
  page.appendChild(dailyPanel);

  // Detail cards grid (8 Apple-style cards)
  const grid = document.createElement('div');
  grid.className = 'details-grid';

  // UV Index card
  const uvVal = current ? Math.round(current.uvIndex) : 0;
  const uvMax = today?.uvMax ? Math.round(today.uvMax) : uvVal;
  grid.innerHTML += `
    <div class="detail-card">
      <div class="detail-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><g stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></g></svg>
        UV Index
      </div>
      <div class="detail-value">${uvVal}</div>
      <div class="detail-sub">${getUVDescription(uvVal)}</div>
      ${buildUVGauge(uvVal)}
      <div class="detail-note">${getUVNote(uvVal)}</div>
    </div>
  `;

  // Sunrise / Sunset card
  const sunrise = today?.sunrise ? new Date(today.sunrise) : null;
  const sunset = today?.sunset ? new Date(today.sunset) : null;
  const now = new Date();
  const isBefore = sunset && now < sunset;
  grid.innerHTML += `
    <div class="detail-card">
      <div class="detail-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="8 2 12 6 16 2"/></svg>
        ${isBefore ? 'Západ slunce' : 'Východ slunce'}
      </div>
      <div class="detail-value">${isBefore
        ? (sunset ? sunset.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—')
        : (sunrise ? sunrise.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '—')
      }</div>
      ${buildSunArc(sunrise, sunset)}
      <div class="detail-note">${isBefore
        ? (sunrise ? `Východ: ${sunrise.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}` : '')
        : (sunset ? `Západ: ${sunset.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}` : '')
      }</div>
    </div>
  `;

  // Wind card
  grid.innerHTML += `
    <div class="detail-card">
      <div class="detail-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>
        Vítr
      </div>
      ${buildWindCompass(current?.wind, current?.windDirection, current?.windGusts)}
    </div>
  `;

  // Feels Like card
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

  // Precipitation card
  grid.innerHTML += `
    <div class="detail-card">
      <div class="detail-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
        Srážky
      </div>
      <div class="detail-value">${current ? `${current.precipitation} mm` : '—'}</div>
      <div class="detail-sub">za poslední hodinu</div>
      <div class="detail-note">${current ? `${current.precipProb}% pravděpodobnost` : ''}</div>
    </div>
  `;

  // Humidity card
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

  // Visibility card
  const visKm = current?.visibility != null ? Math.round(current.visibility / 1000) : null;
  grid.innerHTML += `
    <div class="detail-card">
      <div class="detail-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        Viditelnost
      </div>
      <div class="detail-value">${visKm != null ? `${visKm} km` : '—'}</div>
      <div class="detail-note">${current ? getVisibilityNote(current.visibility) : ''}</div>
    </div>
  `;

  // Pressure card
  grid.innerHTML += `
    <div class="detail-card">
      <div class="detail-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 6v6l4 2"/></svg>
        Tlak
      </div>
      <div class="detail-value">${current?.pressure != null ? `${Math.round(current.pressure)}` : '—'}<span class="detail-unit"> hPa</span></div>
      <div class="detail-note">${current ? getPressureNote(current.pressure) : ''}</div>
    </div>
  `;

  page.appendChild(grid);

  // Model info footer
  const footer = document.createElement('div');
  footer.className = 'glass-panel model-footer';
  footer.innerHTML = `<div class="footer-text">ICON D2 + ICON EU · Open-Meteo</div>`;
  page.appendChild(footer);

  return page;
}

/* ---- Mini visualizations for detail cards ---- */

function buildUVGauge(uv) {
  const maxUV = 12;
  const pct = Math.min(uv / maxUV, 1) * 100;
  return `<div class="uv-gauge"><div class="uv-gauge-track"><div class="uv-gauge-fill" style="width:${pct}%"></div><div class="uv-gauge-dot" style="left:${pct}%"></div></div></div>`;
}

function buildSunArc(sunrise, sunset) {
  if (!sunrise || !sunset) return '<div class="sun-arc-placeholder"></div>';
  const now = new Date();
  const total = sunset.getTime() - sunrise.getTime();
  const elapsed = now.getTime() - sunrise.getTime();
  let pct = Math.max(0, Math.min(1, elapsed / total));
  const isDark = now < sunrise || now > sunset;

  const x = 10 + pct * 80;
  const y = 40 - Math.sin(pct * Math.PI) * 30;
  return `
    <div class="sun-arc">
      <svg viewBox="0 0 100 50" class="sun-arc-svg">
        <path d="M10 40 Q50 -5 90 40" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
        <line x1="10" y1="40" x2="90" y2="40" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>
        ${!isDark ? `<circle cx="${x}" cy="${y}" r="3.5" fill="#FFD60A"/>` : ''}
      </svg>
    </div>`;
}

function buildWindCompass(speed, direction, gusts) {
  if (speed == null) return '<div class="detail-value">—</div>';
  const dir = direction || 0;
  const labels = ['S', 'V', 'J', 'Z'];
  return `
    <div class="wind-compass">
      <svg viewBox="0 0 80 80" class="compass-svg">
        <circle cx="40" cy="40" r="35" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>
        <circle cx="40" cy="40" r="25" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>
        ${labels.map((l, i) => {
          const a = i * 90 - 90;
          const rad = a * Math.PI / 180;
          const tx = 40 + 32 * Math.cos(rad);
          const ty = 40 + 32 * Math.sin(rad);
          return `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" fill="rgba(255,255,255,0.5)" font-size="7" font-weight="600">${l}</text>`;
        }).join('')}
        <line x1="40" y1="40" x2="${40 + 20 * Math.sin(dir * Math.PI / 180)}" y2="${40 - 20 * Math.cos(dir * Math.PI / 180)}" stroke="white" stroke-width="2" stroke-linecap="round"/>
        <circle cx="40" cy="40" r="2" fill="white"/>
      </svg>
      <div class="compass-speed">${Math.round(speed)}<span class="detail-unit"> km/h</span></div>
      ${gusts ? `<div class="compass-gusts">Nárazy ${Math.round(gusts)} km/h</div>` : ''}
    </div>`;
}

/* ---- Helpers ---- */

/* buildRange removed - range now built inline in createCityPage with temperature-based gradients */

function buildDailyForecast(hourly) {
  const grouped = {};

  hourly.forEach((hour) => {
    const date = hour.time.split('T')[0];
    if (!grouped[date]) {
      grouped[date] = { temps: [], codes: [], precip: [], precipAmounts: [], humidity: [], wind: [], windDir: [], windGusts: [], pressure: [], uvIndex: [], visibility: [] };
    }

    grouped[date].temps.push(hour.temp);
    grouped[date].codes.push(hour.weatherCode);
    grouped[date].precip.push(hour.precipProb);
    grouped[date].precipAmounts.push(hour.precipitation || 0);
    grouped[date].humidity.push(hour.humidity);
    grouped[date].wind.push(hour.wind);
    grouped[date].windDir.push(hour.windDirection || 0);
    grouped[date].windGusts.push(hour.windGusts || 0);
    grouped[date].pressure.push(hour.pressure);
    grouped[date].uvIndex.push(hour.uvIndex || 0);
    grouped[date].visibility.push(hour.visibility);
  });

  return Object.keys(grouped)
    .sort()
    .slice(0, 10)
    .map((date) => {
      const info = grouped[date];
      const tempMax = Math.max(...info.temps);
      const tempMin = Math.min(...info.temps);
      const avgPrecip = Math.round(info.precip.reduce((sum, val) => sum + val, 0) / info.precip.length);
      const totalPrecip = info.precipAmounts.reduce((sum, val) => sum + val, 0);

      const codeCounts = {};
      info.codes.forEach((code) => {
        codeCounts[code] = (codeCounts[code] || 0) + 1;
      });
      const weatherCode = Number(
        Object.keys(codeCounts).reduce((a, b) => (codeCounts[a] > codeCounts[b] ? a : b), 0)
      );

      return { date, tempMax, tempMin, avgPrecip, totalPrecip: Math.round(totalPrecip * 10) / 10, weatherCode };
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
  if (code === 1) return 'Převážně jasno';
  if (code === 2) return 'Polojasno';
  if (code === 3) return 'Oblačno';
  if ([45, 48].includes(code)) return 'Mlha';
  if ([51, 53, 55].includes(code)) return 'Mrholení';
  if ([56, 57].includes(code)) return 'Mrznoucí mrholení';
  if ([61, 63].includes(code)) return 'Déšť';
  if (code === 65) return 'Silný déšť';
  if ([66, 67].includes(code)) return 'Mrznoucí déšť';
  if ([80, 81, 82].includes(code)) return 'Přeháňky';
  if ([71, 73, 75].includes(code)) return 'Sněžení';
  if (code === 77) return 'Sněhové zrna';
  if ([85, 86].includes(code)) return 'Sněhové přeháňky';
  if (code === 95) return 'Bouřky';
  if ([96, 99].includes(code)) return 'Bouřky s krupobitím';
  return 'Proměnlivo';
}

/* ---- SVG Weather Icons (SF Symbols style) ---- */

const SVG_ICONS = {
  sun: `<svg class="w-icon" viewBox="0 0 36 36"><circle cx="18" cy="18" r="6" fill="#FFD60A" stroke="#FFD60A" stroke-width="0.5"/><g stroke="#FFD60A" stroke-width="2" stroke-linecap="round"><line x1="18" y1="3" x2="18" y2="7"/><line x1="18" y1="29" x2="18" y2="33"/><line x1="3" y1="18" x2="7" y2="18"/><line x1="29" y1="18" x2="33" y2="18"/><line x1="7.4" y1="7.4" x2="10.2" y2="10.2"/><line x1="25.8" y1="25.8" x2="28.6" y2="28.6"/><line x1="7.4" y1="28.6" x2="10.2" y2="25.8"/><line x1="25.8" y1="10.2" x2="28.6" y2="7.4"/></g></svg>`,
  sunCloud: `<svg class="w-icon" viewBox="0 0 36 36"><circle cx="20" cy="12" r="5" fill="#FFD60A" stroke="#FFD60A" stroke-width="0.5"/><g stroke="#FFD60A" stroke-width="1.5" stroke-linecap="round"><line x1="20" y1="2" x2="20" y2="5"/><line x1="28" y1="6" x2="26" y2="8"/><line x1="30" y1="12" x2="27" y2="12"/><line x1="12" y1="6" x2="14" y2="8"/><line x1="10" y1="12" x2="13" y2="12"/></g><path d="M10 30 C4 30 2 26 5 23 C3 18 8 15 13 16 C14 12 22 12 24 16 C28 16 30 19 28 23 C31 26 28 30 24 30Z" fill="rgba(255,255,255,0.9)" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/></svg>`,
  cloud: `<svg class="w-icon" viewBox="0 0 36 36"><path d="M10 28 C4 28 2 24 5 21 C3 16 8 13 13 14 C14 10 22 10 24 14 C28 14 30 17 28 21 C31 24 28 28 24 28Z" fill="rgba(255,255,255,0.85)" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/></svg>`,
  fog: `<svg class="w-icon" viewBox="0 0 36 36"><path d="M10 20 C4 20 2 17 5 14 C3 10 8 7 13 8 C14 4 22 4 24 8 C28 8 30 11 28 14 C31 17 28 20 24 20Z" fill="rgba(255,255,255,0.7)" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/><g stroke="rgba(255,255,255,0.7)" stroke-width="2" stroke-linecap="round"><line x1="6" y1="24" x2="30" y2="24"/><line x1="8" y1="28" x2="28" y2="28"/><line x1="10" y1="32" x2="26" y2="32"/></g></svg>`,
  drizzle: `<svg class="w-icon" viewBox="0 0 36 36"><path d="M10 18 C4 18 2 15 5 12 C3 8 8 5 13 6 C14 2 22 2 24 6 C28 6 30 9 28 12 C31 15 28 18 24 18Z" fill="rgba(255,255,255,0.85)" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/><g stroke="#64D2FF" stroke-width="1.5" stroke-linecap="round"><line x1="12" y1="22" x2="11" y2="26"/><line x1="18" y1="22" x2="17" y2="26"/><line x1="24" y1="22" x2="23" y2="26"/></g></svg>`,
  rain: `<svg class="w-icon" viewBox="0 0 36 36"><path d="M10 16 C4 16 2 13 5 10 C3 6 8 3 13 4 C14 0 22 0 24 4 C28 4 30 7 28 10 C31 13 28 16 24 16Z" fill="rgba(255,255,255,0.85)" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/><g stroke="#64D2FF" stroke-width="2" stroke-linecap="round"><line x1="11" y1="20" x2="9" y2="27"/><line x1="17" y1="20" x2="15" y2="27"/><line x1="23" y1="20" x2="21" y2="27"/><line x1="14" y1="28" x2="12" y2="33"/><line x1="20" y1="28" x2="18" y2="33"/></g></svg>`,
  freezingRain: `<svg class="w-icon" viewBox="0 0 36 36"><path d="M10 16 C4 16 2 13 5 10 C3 6 8 3 13 4 C14 0 22 0 24 4 C28 4 30 7 28 10 C31 13 28 16 24 16Z" fill="rgba(255,255,255,0.85)" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/><g stroke="#64D2FF" stroke-width="2" stroke-linecap="round"><line x1="11" y1="20" x2="9" y2="27"/><line x1="23" y1="20" x2="21" y2="27"/></g><circle cx="17" cy="25" r="2" fill="none" stroke="#A0E5FF" stroke-width="1.5"/></svg>`,
  snow: `<svg class="w-icon" viewBox="0 0 36 36"><path d="M10 18 C4 18 2 15 5 12 C3 8 8 5 13 6 C14 2 22 2 24 6 C28 6 30 9 28 12 C31 15 28 18 24 18Z" fill="rgba(255,255,255,0.85)" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/><g fill="#B8D4E8"><circle cx="12" cy="23" r="1.5"/><circle cx="18" cy="25" r="1.5"/><circle cx="24" cy="23" r="1.5"/><circle cx="15" cy="29" r="1.5"/><circle cx="21" cy="29" r="1.5"/></g></svg>`,
  thunder: `<svg class="w-icon" viewBox="0 0 36 36"><path d="M10 16 C4 16 2 13 5 10 C3 6 8 3 13 4 C14 0 22 0 24 4 C28 4 30 7 28 10 C31 13 28 16 24 16Z" fill="rgba(200,200,200,0.85)" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/><polygon points="19,16 14,25 18,25 15,34 23,22 19,22 22,16" fill="#FFD60A"/></svg>`,
  moon: `<svg class="w-icon" viewBox="0 0 36 36"><path d="M22 6 C14 8 10 16 14 24 C18 30 26 30 30 26 C24 30 14 28 12 18 C10 10 16 4 22 6Z" fill="#F0E68C" stroke="#F0E68C" stroke-width="0.5"/></svg>`,
  moonCloud: `<svg class="w-icon" viewBox="0 0 36 36"><path d="M22 2 C16 3 13 9 16 15 C14 14 12 14 10 15" fill="none"/><path d="M24 4 C18 5 16 10 18 14 C14 12 10 14 10 14" fill="none"/><path d="M25 3 C19 5 17 10 20 14" fill="none" stroke="#F0E68C" stroke-width="0"/><path d="M22 2C18 4 16 8 18 12" fill="none"/><circle cx="23" cy="8" r="0" fill="#F0E68C"/><path d="M26 3 Q20 4 19 10 Q18 6 22 3 Q26 1 28 5 Q24 2 26 3Z" fill="#F0E68C"/><path d="M10 30 C4 30 2 26 5 23 C3 18 8 15 13 16 C14 12 22 12 24 16 C28 16 30 19 28 23 C31 26 28 30 24 30Z" fill="rgba(200,210,230,0.85)" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/></svg>`
};

function getWeatherIcon(code, timeStr) {
  const isNight = isNightTime(timeStr);
  if (code === 0) return isNight ? SVG_ICONS.moon : SVG_ICONS.sun;
  if ([1, 2].includes(code)) return isNight ? SVG_ICONS.moonCloud : SVG_ICONS.sunCloud;
  if (code === 3) return SVG_ICONS.cloud;
  if ([45, 48].includes(code)) return SVG_ICONS.fog;
  if ([51, 53, 55].includes(code)) return SVG_ICONS.drizzle;
  if ([56, 57, 66, 67].includes(code)) return SVG_ICONS.freezingRain;
  if ([61, 63, 65, 80, 81, 82].includes(code)) return SVG_ICONS.rain;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return SVG_ICONS.snow;
  if ([95, 96, 99].includes(code)) return SVG_ICONS.thunder;
  return SVG_ICONS.cloud;
}

function isNightTime(timeStr) {
  if (!timeStr) {
    const h = new Date().getHours();
    return h < 6 || h >= 21;
  }
  const h = new Date(timeStr).getHours();
  return h < 6 || h >= 21;
}

function getWeatherBgClass(code) {
  if (code === undefined || code === null) return 'weather-cloudy';
  const hour = new Date().getHours();
  const isNight = hour < 6 || hour >= 21;

  if (isNight) return 'weather-night';
  if (code === 0) return 'weather-clear';
  if ([1, 2, 3].includes(code)) return 'weather-partly';
  if ([45, 48].includes(code)) return 'weather-fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'weather-rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'weather-snow';
  if ([95, 96, 99].includes(code)) return 'weather-storm';
  return 'weather-cloudy';
}

/* ---- Temperature Color System (Apple-style) ---- */

function getTempColor(temp) {
  if (temp <= -10) return '#007AFF';
  if (temp <= 0) return '#5AC8FA';
  if (temp <= 10) return '#64D2FF';
  if (temp <= 15) return '#30D158';
  if (temp <= 20) return '#A8D86C';
  if (temp <= 25) return '#FFD60A';
  if (temp <= 30) return '#FF9F0A';
  if (temp <= 35) return '#FF6723';
  return '#FF453A';
}

function buildTempGradient(minTemp, maxTemp) {
  const steps = 5;
  const colors = [];
  for (let i = 0; i <= steps; i++) {
    const t = minTemp + (maxTemp - minTemp) * (i / steps);
    colors.push(getTempColor(t));
  }
  return `linear-gradient(90deg, ${colors.join(', ')})`;
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

function getUVDescription(uv) {
  if (uv <= 2) return 'Nízký';
  if (uv <= 5) return 'Střední';
  if (uv <= 7) return 'Vysoký';
  if (uv <= 10) return 'Velmi vysoký';
  return 'Extrémní';
}

function getUVNote(uv) {
  if (uv <= 2) return 'Není potřeba ochrana.';
  if (uv <= 5) return 'Používejte opalovací krém.';
  if (uv <= 7) return 'Omezte pobyt na slunci.';
  return 'Vyhněte se polednímu slunci.';
}

function getVisibilityNote(vis) {
  if (vis == null) return '';
  const km = vis / 1000;
  if (km >= 10) return 'Výborná viditelnost.';
  if (km >= 5) return 'Dobrá viditelnost.';
  if (km >= 1) return 'Snížená viditelnost.';
  return 'Velmi špatná viditelnost.';
}

function getPressureNote(pressure) {
  if (pressure == null) return '';
  if (pressure >= 1025) return 'Vysoký tlak – jasno.';
  if (pressure >= 1013) return 'Normální tlak.';
  return 'Nízký tlak – možné srážky.';
}

function getHourlySummary(hourly) {
  if (!hourly || hourly.length === 0) return '';
  const rainCodes = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
  for (let i = 0; i < Math.min(hourly.length, 24); i++) {
    if (rainCodes.includes(hourly[i].weatherCode)) {
      if (i === 0) return 'Aktuálně prší. Podívejte se, kdy přestane.';
      if (i <= 2) return `Srážky očekávány brzy.`;
      return `Srážky očekávány za ${i} h.`;
    }
  }
  const allClear = hourly.slice(0, 24).every(h => h.weatherCode <= 3);
  if (allClear) return 'Jasno po celý den.';
  return 'Podmínky na příštích 48 hodin.';
}

if (typeof module !== 'undefined') {
  module.exports = { getWeatherIcon };
}
