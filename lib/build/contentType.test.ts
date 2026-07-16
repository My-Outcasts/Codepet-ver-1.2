import { describe, it, expect } from 'vitest';
import { contentTypeFor } from './contentType';

describe('contentTypeFor', () => {
  it('infers html', () => {
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8');
  });

  it('infers css', () => {
    expect(contentTypeFor('assets/app.css')).toBe('text/css');
  });

  it('infers js', () => {
    expect(contentTypeFor('assets/app.js')).toBe('text/javascript');
  });

  it('infers json, svg, png, jpg/jpeg, gif, ico, and woff2', () => {
    expect(contentTypeFor('data.json')).toBe('application/json');
    expect(contentTypeFor('icon.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('logo.png')).toBe('image/png');
    expect(contentTypeFor('photo.jpg')).toBe('image/jpeg');
    expect(contentTypeFor('photo.jpeg')).toBe('image/jpeg');
    expect(contentTypeFor('anim.gif')).toBe('image/gif');
    expect(contentTypeFor('favicon.ico')).toBe('image/x-icon');
    expect(contentTypeFor('font.woff2')).toBe('font/woff2');
  });

  it('defaults to octet-stream for an unknown extension', () => {
    expect(contentTypeFor('archive.zip')).toBe('application/octet-stream');
  });

  it('defaults to octet-stream when there is no extension', () => {
    expect(contentTypeFor('README')).toBe('application/octet-stream');
  });
});
