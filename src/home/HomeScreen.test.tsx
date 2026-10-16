// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HomeScreen } from './HomeScreen';

afterEach(cleanup);

describe('HomeScreen', () => {
  it('offers Open from GitHub Gist, and no Google Drive option in a build without a Google client ID', () => {
    render(<HomeScreen />);
    expect(screen.getByRole('button', { name: 'Open from GitHub Gist' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google Drive/ })).toBeNull();
  });
});
