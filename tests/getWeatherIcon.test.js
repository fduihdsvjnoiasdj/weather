global.document = { addEventListener: jest.fn() };
global.navigator = {};
const { getWeatherIcon } = require('../app');

describe('getWeatherIcon', () => {
  test('returns sun SVG for code 0 (daytime)', () => {
    const icon = getWeatherIcon(0, '2024-06-15T12:00');
    expect(icon).toContain('<svg');
    expect(icon).toContain('FFD60A'); // sun yellow color
  });

  test('returns moon SVG for code 0 (nighttime)', () => {
    const icon = getWeatherIcon(0, '2024-06-15T23:00');
    expect(icon).toContain('<svg');
    expect(icon).toContain('F0E68C'); // moon color
  });

  test('returns cloud SVG for code 3', () => {
    const icon = getWeatherIcon(3);
    expect(icon).toContain('<svg');
    expect(icon).toContain('class="w-icon"');
  });

  test('returns fog SVG for code 45', () => {
    const icon = getWeatherIcon(45);
    expect(icon).toContain('<svg');
    expect(icon).toContain('<line'); // fog has horizontal lines
  });

  test('returns rain SVG for code 61', () => {
    const icon = getWeatherIcon(61);
    expect(icon).toContain('<svg');
    expect(icon).toContain('64D2FF'); // rain blue color
  });

  test('returns thunder SVG for code 95', () => {
    const icon = getWeatherIcon(95);
    expect(icon).toContain('<svg');
    expect(icon).toContain('polygon'); // lightning bolt
  });

  test('returns snow SVG for code 71', () => {
    const icon = getWeatherIcon(71);
    expect(icon).toContain('<svg');
    expect(icon).toContain('B8D4E8'); // snow color
  });
});
