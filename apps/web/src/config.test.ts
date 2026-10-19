import { describe, expect, it } from 'vitest';
import config from '../astro.config.mjs';

describe('web astro config', () => {
  it('is static, trailing-slash always, directory format', () => {
    expect(config.site).toBe('https://www.mullnyphotos.cz');
    expect(config.trailingSlash).toBe('always');
    expect(config.output).toBe('static');
    expect(config.build?.format).toBe('directory');
  });
});
