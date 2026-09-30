import { describe, expect, it } from 'vitest';

import type { UploadPiece, UploadRecord } from './music';
import { isUnfinished, PIECE_STATUS, recordStatus } from './music';

const piece = (status: string, assetId: number | null = null): UploadPiece => ({
  name: 'song',
  path: 'C:/media/song.mp3',
  bytes: 10,
  operationId: 'op-1',
  assetId,
  status,
});

const record = (statuses: string[]): UploadRecord => ({
  id: 'r1',
  title: 'song',
  uploadedAt: '2026-01-01T00:00:00Z',
  wasSplit: statuses.length > 1,
  totalBytes: 10,
  pieces: statuses.map((status) => piece(status)),
});

describe('recordStatus', () => {
  it('is validating while Roblox is still checking', () => {
    expect(recordStatus(record([PIECE_STATUS.validating]))).toBe(PIECE_STATUS.validating);
  });

  it('is accepted only when every piece is accepted', () => {
    // A split track must not read as done while one of its parts is still
    // being checked, or the user wires up a part Roblox goes on to refuse.
    expect(recordStatus(record([PIECE_STATUS.accepted, PIECE_STATUS.validating]))).toBe(
      PIECE_STATUS.validating,
    );
    expect(recordStatus(record([PIECE_STATUS.accepted, PIECE_STATUS.accepted]))).toBe(
      PIECE_STATUS.accepted,
    );
  });

  it('is rejected when any single piece was refused', () => {
    expect(recordStatus(record([PIECE_STATUS.accepted, PIECE_STATUS.rejected]))).toBe(
      PIECE_STATUS.rejected,
    );
  });

  it('is validating while a piece is still uploading', () => {
    expect(recordStatus(record([PIECE_STATUS.uploading]))).toBe(PIECE_STATUS.validating);
  });

  it('has no accepted state for an empty record', () => {
    // An empty row must not read as a success just because nothing refused it.
    expect(recordStatus(record([]))).not.toBe(PIECE_STATUS.accepted);
  });
});

describe('isUnfinished', () => {
  it('treats an in-flight or checking piece as unfinished', () => {
    // These are the states a relaunch has to pick back up, so they must be the
    // ones that count as unfinished.
    expect(isUnfinished(piece(PIECE_STATUS.uploading))).toBe(true);
    expect(isUnfinished(piece(PIECE_STATUS.validating))).toBe(true);
  });

  it('treats a settled piece as finished', () => {
    expect(isUnfinished(piece(PIECE_STATUS.accepted))).toBe(false);
    expect(isUnfinished(piece(PIECE_STATUS.rejected))).toBe(false);
  });
});

describe('the id a user sees', () => {
  it('is available before validation finishes', () => {
    // This is the behaviour the flow exists for: Roblox reveals the id while it
    // is still checking, so the history can show it immediately.
    const validating = piece(PIECE_STATUS.validating, 12_345);
    expect(validating.assetId).toBe(12_345);
    expect(recordStatus({ ...record([]), pieces: [validating] })).toBe(PIECE_STATUS.validating);
  });

  it('is null rather than zero when Roblox has not given one', () => {
    // A zero would render as a real, copyable, wrong id.
    expect(piece(PIECE_STATUS.validating).assetId).toBeNull();
  });
});
