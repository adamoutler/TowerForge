// A made-up export battle, through the real import, for the coin tests.

import { parseGameExport } from './gameExport';
import type { BattleReport } from './battleReport';
import { battle, makeExport } from '../test/makeExport';

export function battleToReportForTest(fields: Record<string, unknown>): BattleReport {
    return parseGameExport(makeExport({ BattleHistory: [battle(fields)] })).battles[0];
}
