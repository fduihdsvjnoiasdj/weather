global.document = { addEventListener: jest.fn() };
global.navigator = {};
const { getWeatherIcon } = require('../app');

describe('getWeatherIcon', () => {
  test('returns sun for code 0', () => {
    expect(getWeatherIcon(0)).toBe('☀️');
  });

  test('returns partly cloudy for code 1', () => {
    expect(getWeatherIcon(1)).toBe('🌤️');
  });

  test('returns fog for code 45', () => {
    expect(getWeatherIcon(45)).toBe('🌫️');
  });

  test('returns rain for code 61', () => {
    expect(getWeatherIcon(61)).toBe('🌧️');
  });

  test('returns thunderstorm for code 95', () => {
    expect(getWeatherIcon(95)).toBe('⛈️');
  });
});
