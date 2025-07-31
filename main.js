const sampleData = {
  location: 'Prague',
  condition: 'Clear',
  currentTemp: 23,
  high: 27,
  low: 14,
  hourlyForecast: [
    { time: '12:00', iconPath: '', temp: 24 },
    { time: '13:00', iconPath: '', temp: 25 },
    { time: '14:00', iconPath: '', temp: 26 },
    { time: '15:00', iconPath: '', temp: 25 },
    { time: '16:00', iconPath: '', temp: 24 }
  ]
};

function render(data) {
  document.querySelector('.location').textContent = data.location;
  document.querySelector('.condition').textContent = data.condition;
  document.querySelector('.temperature').textContent = `${data.currentTemp}°`;
  document.querySelector('.high').textContent = `High – ${data.high}°`;
  document.querySelector('.low').textContent = `Low – ${data.low}°`;
  const list = document.getElementById('hours-list');
  list.innerHTML = '';
  data.hourlyForecast.forEach((h) => {
    const li = document.createElement('li');
    li.className = 'hour-item';
    li.innerHTML = `
      <span class="hour-time">${h.time}</span>
      <div class="hour-icon">${h.iconPath ? `<img src="${h.iconPath}" alt="">` : '☀️'}</div>
      <span class="hour-temp">${h.temp}°</span>`;
    list.appendChild(li);
  });
}

window.addEventListener('load', () => {
  render(sampleData);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }
});
