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

/* ---- Geolocation ---- */

function getUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
    );
  });
}

async function reverseGeocode(latitude, longitude) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${latitude.toFixed(2)},${longitude.toFixed(2)}&count=1&language=cs`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.results && data.results.length > 0) {
      return data.results[0].name;
    }
  } catch (_) {
    // Fallback handled below
  }
  return null;
}

async function loadLocations() {
  const stored = localStorage.getItem(LOCATIONS_KEY);
  let locs;

  if (stored) {
    try {
      locs = JSON.parse(stored);
    } catch (_error) {
      locs = null;
    }
  }

  // Ensure geolocation entry exists
  const hasGeoLoc = locs && locs.some((l) => l.isGeoLocation);

  if (!locs) {
    // First launch — try geolocation, fallback to defaults
    const geoPos = await getUserLocation();
    if (geoPos) {
      locs = [
        { name: 'Moje poloha', latitude: geoPos.latitude, longitude: geoPos.longitude, isGeoLocation: true },
        ...DEFAULT_CITIES
      ];
    } else {
      locs = [
        { name: 'Moje poloha', isGeoLocation: true },
        ...DEFAULT_CITIES
      ];
    }
  } else if (!hasGeoLoc) {
    // Existing data but no geoloc entry — add it at position 0
    const geoPos = await getUserLocation();
    if (geoPos) {
      locs.unshift({ name: 'Moje poloha', latitude: geoPos.latitude, longitude: geoPos.longitude, isGeoLocation: true });
    } else {
      locs.unshift({ name: 'Moje poloha', isGeoLocation: true });
    }
  } else {
    // Refresh geolocation coordinates
    const geoLoc = locs.find((l) => l.isGeoLocation);
    if (geoLoc) {
      const geoPos = await getUserLocation();
      if (geoPos) {
        geoLoc.latitude = geoPos.latitude;
        geoLoc.longitude = geoPos.longitude;
      }
    }
  }

  // Geocode any location missing coordinates
  for (const loc of locs) {
    if (!loc.latitude || !loc.longitude) {
      if (loc.isGeoLocation) continue; // Skip geoloc if denied
      const geo = await geocodeCity(loc.name);
      if (geo) {
        loc.latitude = geo.latitude;
        loc.longitude = geo.longitude;
      }
    }
  }

  // Remove geoloc entry if it still has no coordinates (permission denied)
  locs = locs.filter((l) => !l.isGeoLocation || (l.latitude && l.longitude));

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
            // Insert after geolocation entry (which is always first)
            const insertIdx = locations[0]?.isGeoLocation ? 1 : 0;
            locations.splice(insertIdx, 0, {
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

/* ---- City List with Drag & Drop ---- */

let dragState = null;

function renderCityList() {
  const container = document.getElementById('city-list');
  container.innerHTML = '';

  locations.forEach((loc, index) => {
    const cached = weatherCache.get(locKey(loc));
    const card = document.createElement('div');
    card.className = 'city-list-card';
    card.dataset.index = index;

    const current = cached?.current;
    const today = cached?.daily?.[0];

    const now = new Date();
    const timeStr = now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });

    const displayName = loc.isGeoLocation ? `📍 ${loc.name}` : loc.name;
    const canRemove = !loc.isGeoLocation;
    const canDrag = !loc.isGeoLocation;

    card.innerHTML = `
      ${canDrag ? '<div class="drag-handle"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg></div>' : '<div class="drag-handle-spacer"></div>'}
      <div class="city-list-left">
        <div class="city-list-name">${displayName}</div>
        <div class="city-list-time">${timeStr}</div>
        <div class="city-list-condition">${current ? describeWeather(current.weatherCode) : ''}</div>
      </div>
      <div class="city-list-right">
        <div class="city-list-temp">${current ? `${Math.round(current.temp)}°` : '—'}</div>
        <div class="city-list-highlow">${today ? `H:${Math.round(today.tempMax)}° L:${Math.round(today.tempMin)}°` : ''}</div>
      </div>
      ${canRemove ? '<button class="city-list-remove" type="button" title="Odstranit">×</button>' : ''}
    `;

    // Card click → navigate to page
    card.addEventListener('click', (e) => {
      if (e.target.closest('.city-list-remove') || e.target.closest('.drag-handle')) return;
      closeSearchOverlay();
      scrollToPage(index);
    });

    // Remove button
    if (canRemove) {
      card.querySelector('.city-list-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        locations = locations.filter((item) => item !== loc);
        saveLocations();
        weatherCache.delete(locKey(loc));
        if (currentPage >= locations.length) currentPage = Math.max(0, locations.length - 1);
        await updateAllLocations();
        renderCityList();
      });
    }

    // Touch drag & drop (only for non-geolocation items)
    if (canDrag) {
      const handle = card.querySelector('.drag-handle');
      handle.addEventListener('touchstart', (e) => onDragStart(e, card, index), { passive: false });
    }

    container.appendChild(card);
  });
}

function onDragStart(e, card, index) {
  e.preventDefault();
  e.stopPropagation();

  const container = document.getElementById('city-list');
  const touch = e.touches[0];
  const rect = card.getBoundingClientRect();

  // Create ghost clone
  const ghost = card.cloneNode(true);
  ghost.className = 'city-list-card drag-ghost';
  ghost.style.width = rect.width + 'px';
  ghost.style.top = rect.top + 'px';
  ghost.style.left = rect.left + 'px';
  document.body.appendChild(ghost);

  card.classList.add('dragging');

  dragState = {
    sourceIndex: index,
    currentIndex: index,
    ghost,
    card,
    startY: touch.clientY,
    offsetY: touch.clientY - rect.top,
    container
  };

  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('touchend', onDragEnd);
}

function onDragMove(e) {
  if (!dragState) return;
  e.preventDefault();

  const touch = e.touches[0];
  dragState.ghost.style.top = (touch.clientY - dragState.offsetY) + 'px';

  // Determine which card we're over
  const cards = Array.from(dragState.container.querySelectorAll('.city-list-card:not(.dragging)'));
  let targetIndex = dragState.sourceIndex;

  for (const otherCard of cards) {
    const otherRect = otherCard.getBoundingClientRect();
    const otherMid = otherRect.top + otherRect.height / 2;

    if (touch.clientY < otherMid) {
      targetIndex = parseInt(otherCard.dataset.index, 10);
      break;
    }
    targetIndex = parseInt(otherCard.dataset.index, 10) + 1;
  }

  // Clamp: can't move to position 0 if that's geolocation
  if (locations[0]?.isGeoLocation && targetIndex < 1) {
    targetIndex = 1;
  }

  // Visual indicator
  cards.forEach((c) => c.classList.remove('drag-over-above', 'drag-over-below'));
  if (targetIndex !== dragState.sourceIndex) {
    const indicator = cards.find((c) => parseInt(c.dataset.index, 10) === targetIndex);
    if (indicator) {
      indicator.classList.add('drag-over-above');
    } else if (cards.length > 0) {
      cards[cards.length - 1].classList.add('drag-over-below');
    }
  }

  dragState.currentIndex = targetIndex;
}

async function onDragEnd() {
  if (!dragState) return;

  document.removeEventListener('touchmove', onDragMove);
  document.removeEventListener('touchend', onDragEnd);

  dragState.ghost.remove();
  dragState.card.classList.remove('dragging');

  const { sourceIndex, currentIndex } = dragState;
  dragState = null;

  if (sourceIndex !== currentIndex) {
    const [moved] = locations.splice(sourceIndex, 1);
    const insertAt = currentIndex > sourceIndex ? currentIndex - 1 : currentIndex;
    locations.splice(insertAt, 0, moved);
    saveLocations();
    await updateAllLocations();
  }

  renderCityList();
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
    const isActive = i === currentPage;

    if (loc.isGeoLocation) {
      // Location arrow icon (like Apple Weather)
      dot.className = `page-dot loc-dot${isActive ? ' active' : ''}`;
      dot.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>';
    } else {
      dot.className = `page-dot${isActive ? ' active' : ''}`;
    }

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

  const d2Url = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weathercode,relative_humidity_2m,windspeed_10m&forecast_hours=48&model=icon_d2&timezone=Europe%2FPrague`;
  const euUrl = `https://api.open-meteo.com/v1/dwd-icon?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weathercode,relative_humidity_2m,windspeed_10m&forecast_days=5&model=icon_eu&timezone=Europe%2FPrague`;

  try {
    const [d2Resp, euResp] = await Promise.all([fetch(d2Url), fetch(euUrl)]);
    const [d2Data, euData] = await Promise.all([d2Resp.json(), euResp.json()]);

    // Parse ICON D2 hourly (48h)
    const d2Hourly = parseHourly(d2Data, 48);

    // Parse ICON EU hourly (full 5 days)
    const euHourly = parseHourly(euData, 120);

    const current = d2Hourly[0] || null;
    const daily = buildExtendedDaily(d2Hourly, euHourly);

    return { current, hourly: d2Hourly, daily };
  } catch (error) {
    console.error('Chyba při načítání předpovědi:', error);
    return { current: null, hourly: [], daily: [] };
  }
}

function parseHourly(data, maxHours) {
  const time = data.hourly?.time || [];
  const temperatures = data.hourly?.temperature_2m || [];
  const apparent = data.hourly?.apparent_temperature || [];
  const precipProb = data.hourly?.precipitation_probability || [];
  const weathercode = data.hourly?.weathercode || [];
  const humidity = data.hourly?.relative_humidity_2m || [];
  const wind = data.hourly?.windspeed_10m || [];

  return time.slice(0, maxHours).map((hour, index) => ({
    time: hour,
    temp: temperatures[index],
    apparent: apparent[index],
    precipProb: precipProb[index] || 0,
    weatherCode: weathercode[index],
    humidity: humidity[index],
    wind: wind[index]
  }));
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
  const displayName = loc.isGeoLocation ? `📍 ${loc.name}` : loc.name;
  header.innerHTML = `
    <div class="city-name">${displayName}</div>
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

  // Daily panel — 5 day forecast
  const dailyCount = weather.daily.length;
  const dailyPanel = document.createElement('div');
  dailyPanel.className = 'glass-panel';
  dailyPanel.innerHTML = `
    <div class="panel-label">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      Předpověď na ${dailyCount} ${dailyCount === 1 ? 'den' : dailyCount < 5 ? 'dny' : 'dní'}
    </div>
    <div class="daily-list"></div>
  `;

  const minTemp = Math.min(...weather.daily.map((d) => d.tempMin));
  const maxTemp = Math.max(...weather.daily.map((d) => d.tempMax));
  const dailyList = dailyPanel.querySelector('.daily-list');

  weather.daily.forEach((day, index) => {
    const row = document.createElement('div');
    row.className = 'daily-row';
    const dayLabel = index === 0 ? 'Dnes' : formatDay(day.date);
    const modelBadge = day.source === 'eu' ? '<span class="model-badge">EU</span>' : '';
    row.innerHTML = `
      <span class="day-name">${dayLabel}</span>
      <span class="day-icon">${getWeatherIcon(day.weatherCode)}</span>
      <span class="day-min">${Math.round(day.tempMin)}°</span>
      <div class="temp-range">${buildRange(day.tempMin, day.tempMax, minTemp, maxTemp)}</div>
      <span class="day-max">${Math.round(day.tempMax)}°${modelBadge}</span>
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
      ICON D2 (48h) + ICON EU (5 dní) · Open-Meteo
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

function buildExtendedDaily(d2Hourly, euHourly) {
  // Build daily from D2 (days 1–2)
  const d2Daily = buildDailyFromHourly(d2Hourly, 'd2');

  // Build daily from EU (all 5 days)
  const euDaily = buildDailyFromHourly(euHourly, 'eu');

  // D2 covers first 2 dates. Take remaining from EU.
  const d2Dates = new Set(d2Daily.map((d) => d.date));
  const euExtra = euDaily.filter((d) => !d2Dates.has(d.date));

  return [...d2Daily, ...euExtra].sort((a, b) => a.date.localeCompare(b.date));
}

function buildDailyFromHourly(hourly, source) {
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

      return { date, tempMax, tempMin, avgPrecip, weatherCode, source };
    });
}

function formatHour(hour) {
  const date = new Date(hour);
  return date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(dateStr) {
  const today = new Date();
  const target = new Date(`${dateStr}T12:00:00`);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (target.toDateString() === tomorrow.toDateString()) {
    return 'Zítra';
  }

  return target.toLocaleDateString('cs-CZ', { weekday: 'short' }).replace('.', '');
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
