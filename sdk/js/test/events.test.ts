// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { EventBus, isTopic, patternCovers, topicMatches } from '../src/events.js';

describe('EventBus (MK-009)', () => {
  it('delivers a payload to the handlers of the topic only', () => {
    const bus = new EventBus();
    const selection = vi.fn();
    const other = vi.fn();
    bus.on('maps.selection.changed', selection);
    bus.on('maps.view.changed', other);

    bus.publish('maps.selection.changed', { ids: [1] });

    expect(selection).toHaveBeenCalledWith({ ids: [1] }, 'maps.selection.changed');
    expect(other).not.toHaveBeenCalled();
  });

  it('supports prefix subscriptions', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('traffic.*', handler);

    bus.publish('traffic.alert.raised', 1);
    bus.publish('traffic.forecast.ready', 2);
    bus.publish('transit.alert.raised', 3);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('isolates a failing handler and reports the error', () => {
    const errors = vi.fn();
    const bus = new EventBus(errors);
    const healthy = vi.fn();
    bus.on('a.b', () => {
      throw new Error('broken extension');
    });
    bus.on('a.b', healthy);

    bus.publish('a.b', null);

    expect(healthy).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledWith(expect.any(Error), 'a.b');
  });

  it('stops delivering after unsubscribing', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.on('a.b', handler);

    off();
    off();
    bus.publish('a.b', null);

    expect(handler).not.toHaveBeenCalled();
  });

  it.each(['', 'nodots', 'Upper.case', 'a..b', 'a.*'])(
    'rejects the invalid topic %j when publishing',
    (topic) => {
      expect(() => {
        new EventBus().publish(topic, null);
      }).toThrow(/Invalid event topic/);
    },
  );

  it('rejects an invalid subscription pattern', () => {
    expect(() => new EventBus().on('*', vi.fn())).toThrow(/Invalid event topic/);
  });

  it('tells which topics a pattern receives and which patterns a declaration allows (MK-014)', () => {
    expect(topicMatches('maps.*', 'maps.selection.changed')).toBe(true);
    expect(topicMatches('maps.moved', 'maps.moved')).toBe(true);
    expect(topicMatches('maps.moved', 'maps.moved.again')).toBe(false);
    expect(patternCovers('maps.*', 'maps.selection.*')).toBe(true);
    expect(patternCovers('maps.*', 'maps.moved')).toBe(true);
    expect(patternCovers('maps.moved', 'maps.moved')).toBe(true);
    expect(patternCovers('maps.moved', 'maps.*')).toBe(false);
    expect(patternCovers('maps.*', 'accounts.created')).toBe(false);
    expect(isTopic('maps.moved')).toBe(true);
    expect(isTopic('maps.*')).toBe(false);
    expect(isTopic('maps.*', true)).toBe(true);
    expect(isTopic('maps')).toBe(false);
  });
});
