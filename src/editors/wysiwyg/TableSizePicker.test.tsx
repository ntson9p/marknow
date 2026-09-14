import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TableSizePicker } from './TableSizePicker';

const trigger = () => screen.getByRole('button', { name: 'Insert table' });
const panel = () => screen.queryByRole('dialog', { name: 'Table size' });
const label = () => screen.getByTestId('table-size-label');
/** A cell by its place in the grid, which is not always the size it picks. */
const cell = (row: number, col: number) =>
  document.querySelector<HTMLButtonElement>(`[data-cell="${row}x${col}"]`)!;

function renderPicker() {
  const onPick = vi.fn();
  render(<TableSizePicker active={false} disabled={false} onPick={onPick} />);
  return onPick;
}

/**
 * `fireEvent.click` defaults to `detail: 0`, which is exactly how a browser
 * reports Enter/Space on a focused button — so mouse clicks must say `detail: 1`
 * or the picker rightly treats them as keyboard activations.
 */
const mouseClick = (el: Element) => fireEvent.click(el, { detail: 1 });
const keyActivate = (el: Element) => fireEvent.click(el, { detail: 0 });

afterEach(() => {
  vi.useRealTimers();
});

describe('TableSizePicker', () => {
  it('opens the grid instead of inserting a table outright', () => {
    const onPick = renderPicker();
    mouseClick(trigger());
    expect(panel()).toBeInTheDocument();
    expect(label()).toHaveTextContent('3 × 3');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('reads out the size under the pointer and inserts it on click', () => {
    const onPick = renderPicker();
    mouseClick(trigger());

    fireEvent.pointerOver(cell(4, 6));
    expect(label()).toHaveTextContent('4 × 6');

    mouseClick(cell(4, 6));
    expect(onPick).toHaveBeenCalledWith(4, 6);
    expect(panel()).not.toBeInTheDocument();
  });

  it('picks two rows from the top of the grid, since a lone header is not a table', () => {
    const onPick = renderPicker();
    mouseClick(trigger());

    fireEvent.pointerOver(cell(1, 3));
    expect(label()).toHaveTextContent('2 × 3');

    mouseClick(cell(1, 3));
    expect(onPick).toHaveBeenCalledWith(2, 3);
  });

  it('opens on hover after a beat and closes again when the pointer leaves', () => {
    vi.useFakeTimers();
    renderPicker();

    fireEvent.pointerOver(trigger());
    expect(panel()).not.toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(300));
    expect(panel()).toBeInTheDocument();

    fireEvent.pointerOut(trigger());
    expect(panel()).toBeInTheDocument(); // grace for the gap below the button
    act(() => void vi.advanceTimersByTime(200));
    expect(panel()).not.toBeInTheDocument();
  });

  it('stays put once clicked open, and the second click closes it', () => {
    vi.useFakeTimers();
    renderPicker();

    mouseClick(trigger());
    fireEvent.pointerOut(trigger());
    act(() => void vi.advanceTimersByTime(1000));
    expect(panel()).toBeInTheDocument();

    mouseClick(trigger());
    expect(panel()).not.toBeInTheDocument();
  });

  it('drives the grid from the keyboard, floor included', () => {
    const onPick = renderPicker();
    trigger().focus();
    keyActivate(trigger());
    // Keyboard opens hand the grid its focus; the current size is the tab stop.
    expect(cell(3, 3)).toHaveFocus();

    fireEvent.keyDown(cell(3, 3), { key: 'ArrowRight' });
    expect(label()).toHaveTextContent('3 × 4');
    expect(cell(3, 4)).toHaveFocus();

    fireEvent.keyDown(cell(3, 4), { key: 'ArrowUp' });
    fireEvent.keyDown(cell(2, 4), { key: 'ArrowUp' });
    expect(label()).toHaveTextContent('2 × 4');

    keyActivate(cell(2, 4));
    expect(onPick).toHaveBeenCalledWith(2, 4);
  });

  it('closes on Escape and hands focus back to the button', () => {
    const onPick = renderPicker();
    trigger().focus();
    keyActivate(trigger());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel()).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('closes when the pointer goes down outside it', () => {
    renderPicker();
    mouseClick(trigger());
    fireEvent.pointerDown(document.body);
    expect(panel()).not.toBeInTheDocument();
  });

  it('stays shut while the editor is still mounting', () => {
    render(<TableSizePicker active={false} disabled onPick={vi.fn()} />);
    mouseClick(trigger());
    expect(panel()).not.toBeInTheDocument();
  });
});
