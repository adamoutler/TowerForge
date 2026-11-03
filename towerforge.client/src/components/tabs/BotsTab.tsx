// ============================================================
//  TowerForge Companion — Bots Tab
//  Laid out like the game's Bots screen: preset tabs, then one card
//  per bot with an ON switch for the preset and four stat boxes that
//  show the in-run value (medal level + labs + Bot Range relic +
//  Singularity Harness). Medal levels are set with − / + on each box.
//  Like in game, each preset keeps its own ON/OFF, medal and Bot+
//  levels; only unlocking a bot or its Bot+ is account-wide. Bot+ (game
//  v29) shows once all five bots are owned: one ability per bot, unlocked
//  for 1,250 stones, then levelled with medals.
// ============================================================

import { useGameStore } from '../../store/useGameStore';
import {
    BOT_PLUS_UNLOCK_STONES, BOTS_CONFIG, botsForPreset, getPresetBots, isBotEntryOwned, isBotPlusOwned, vaultBotRange,
} from '../../constants/botData';
import { presetLabel } from '../../constants/gameData';
import { readActiveModuleBonuses } from '../../engine/modBonuses';
import { singularityHarnessRange } from '../../engine/moduleEffects';
import BotBadge from '../common/BotBadge';

// Lab bonuses per bot stat.
// 'add' mode: bonus is added directly to the displayed stat value (same unit).
// 'info' mode: separate derived value shown under the stat boxes (different unit).
type AddBonus = { mode: 'add'; labName: string; statIdx: number; delta: (lv: number) => number };
type InfoBonus = { mode: 'info'; labName: string; statIdx: number; label: string; display: (lv: number) => string };
type BotBonus = AddBonus | InfoBonus;

// Bots whose cooldown labs have a "footgun" — if effective cooldown ≤ effective duration
// the bot stays permanently active, which the community considers a trap.
const COOLDOWN_FOOTGUN_BOTS = new Set(['Thunder Bot', 'Golden Bot', 'Amplify Bot']);

const BOT_LAB_BONUSES: Record<string, BotBonus[]> = {
    'Flame Bot': [
        { mode: 'add',  labName: 'Flame Bot Cooldown',  statIdx: 1, delta: lv => -lv },
        { mode: 'info', labName: 'Flame Bot Burn Stack', statIdx: 2, label: 'Lab Burn Stacks', display: lv => `${lv}` },
    ],
    'Thunder Bot': [
        { mode: 'add',  labName: 'Thunder Bot Cooldown', statIdx: 1, delta: lv => -lv },
        { mode: 'info', labName: 'Thunder Bot Linger',   statIdx: 2, label: 'Lab Linger Time', display: lv => `${(3 + lv * 0.5).toFixed(1)}s` },
    ],
    'Golden Bot': [
        { mode: 'add', labName: 'Golden Bot Duration', statIdx: 0, delta: lv => lv * 0.5 },
        { mode: 'add', labName: 'Golden Bot Cooldown', statIdx: 1, delta: lv => -lv },
    ],
    'Amplify Bot': [
        { mode: 'add', labName: 'Amplify Bot Duration', statIdx: 0, delta: lv => lv * 0.5 },
        { mode: 'add', labName: 'Amplify Bot Cooldown', statIdx: 1, delta: lv => -lv },
    ],
    'Bot Bot': [
        { mode: 'add', labName: 'Bot Bot Duration', statIdx: 0, delta: lv => lv * 0.5 },
        { mode: 'add', labName: 'Bot Bot Cooldown', statIdx: 1, delta: lv => -lv },
    ],
};

// Adds a numeric delta to a display string like "72s" or "20.5s", keeping its format.
function withDelta(displayStr: string, delta: number): string {
    if (!delta || !displayStr) return displayStr;
    const base = parseFloat(displayStr);
    if (isNaN(base)) return displayStr;
    const unit = displayStr.replace(/[-0-9.]/g, '');
    const decimals = Math.max(unit === 'm' ? 2 : 0, (displayStr.split('.')[1] ?? '').replace(/[^0-9]/g, '').length);
    return `${(base + delta).toFixed(decimals)}${unit}`;
}

export default function BotsTab() {
    const botData = useGameStore(s => s.botData);
    const setBotOwned = useGameStore(s => s.setBotOwned);
    const setBotMedal = useGameStore(s => s.setBotMedal);
    const setBotPlusLevel = useGameStore(s => s.setBotPlusLevel);
    const setBotPlusOwned = useGameStore(s => s.setBotPlusOwned);
    const labData = useGameStore(s => s.labData);
    const relicData = useGameStore(s => s.relicData);
    const profile = useGameStore(s => s.profile);
    const activePreset = useGameStore(s => s.activePreset);
    const setActivePreset = useGameStore(s => s.setActivePreset);
    const botLoadouts = useGameStore(s => s.botLoadouts);
    const setBotLoadout = useGameStore(s => s.setBotLoadout);
    const moduleState = useGameStore(s => s.moduleState);
    const perkData = useGameStore(s => s.perkData);
    const cardData = useGameStore(s => s.cardData);
    const vaultLevels = useGameStore(s => s.vaultLevels);

    // Flat range bonuses on every bot: the Bot Range relic and Singularity Harness.
    const harnessRange = singularityHarnessRange(readActiveModuleBonuses(moduleState, perkData, labData, cardData));
    const vaultRange = vaultBotRange(vaultLevels);
    const rangeBonus = (relicData['rBotRange'] ?? 0) + vaultRange + harnessRange;

    // This preset's medal and Bot+ levels, and which bots it has unlocked.
    const presetBotData = botsForPreset(botData, activePreset);
    const ownedBotNames = BOTS_CONFIG.filter(b => isBotEntryOwned(presetBotData[b.name])).map(b => b.name);
    // Bot+ opens once all five bots are unlocked in the preset (the owner's
    // GC Farm preset, with two bots, shows no Bot+ in game).
    const allBotsOwned = ownedBotNames.length >= BOTS_CONFIG.length;

    const presetCount = profile.presets || 2;
    const presets = Array.from({ length: presetCount }, (_, i) => i);
    // Only owned bots can be on; drop any that were un-owned since.
    const presetBots = getPresetBots(botLoadouts, activePreset, ownedBotNames)
        .filter(name => ownedBotNames.includes(name));

    function toggleBotInPreset(name: string) {
        const next = presetBots.includes(name)
            ? presetBots.filter(b => b !== name)
            : [...presetBots, name];
        setBotLoadout(activePreset, next);
    }

    return (
        <div className="botg-page">
            {/* ── Presets (shared with Workshop / Cards) ── */}
            <div className="preset-tabs" style={{ marginBottom: '6px' }}>
                {presets.map(i => (
                    <button
                        key={i}
                        className={`preset-btn ${activePreset === i ? 'active' : ''}`}
                        onClick={() => setActivePreset(i)}
                    >
                        {presetLabel(profile.presetNames, i)}
                    </button>
                ))}
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-dim)', margin: '0 0 12px', lineHeight: 1.6 }}>
                Switch bots ON or OFF and set medal levels for <strong>{presetLabel(profile.presetNames, activePreset)}</strong> —
                each preset keeps its own and unlocks its own bots, like in game. Values include labs, the Bot
                Range relic{vaultRange > 0 ? ', the Vault' : ''}{harnessRange > 0 ? ' and Singularity Harness' : ''}.
            </p>

            <div className="botg-list">
                {BOTS_CONFIG.map(bot => {
                    const entry = presetBotData[bot.name] ?? { medals: [], plusLv: 0 };
                    const owned = isBotEntryOwned(entry);
                    const on = owned && presetBots.includes(bot.name);
                    const medals = entry.medals ?? [];
                    // Bot+ unlocked in this preset counts (and shows) as the game says;
                    // unlocking it needs all five bots in the preset.
                    const plusOwned = isBotPlusOwned(entry);
                    const plusLv = Math.min(entry.plusLv ?? 0, bot.plusMax);
                    const plusMaxed = plusLv >= bot.plusMax;
                    const bonuses = BOT_LAB_BONUSES[bot.name] ?? [];

                    const statValue = (idx: number): number => {
                        const stat = bot.stats[idx];
                        const lv = medals[idx] ?? 0;
                        const shown = lv > 0 ? stat.values[lv - 1] : stat.lv0;
                        const add = bonuses.find(b => b.mode === 'add' && b.statIdx === idx) as AddBonus | undefined;
                        const delta = (add ? add.delta(labData[add.labName] ?? 0) : 0) + (stat.label === 'Range' ? rangeBonus : 0);
                        return parseFloat(withDelta(shown, delta));
                    };

                    const allMaxed = bot.stats.every((stat, idx) => (medals[idx] ?? 0) >= stat.values.length)
                        && (!plusOwned || plusMaxed);

                    const infos = bonuses
                        .filter((b): b is InfoBonus => b.mode === 'info' && (labData[b.labName] ?? 0) > 0)
                        .map(b => `${b.label}: ${b.display(labData[b.labName] ?? 0)}`);

                    // Footgun: cooldown ≤ duration means the bot never goes on cooldown.
                    const footgun = owned && COOLDOWN_FOOTGUN_BOTS.has(bot.name)
                        && (medals[0] ?? 0) > 0 && (medals[1] ?? 0) > 0
                        && statValue(1) <= statValue(0);

                    return (
                        <div key={bot.name} className={`botg-card ${on ? 'on' : ''}`}>
                            <div className="botg-head">
                                <BotBadge name={bot.name} />
                                <span className="botg-name">{bot.name}</span>
                                {!owned && <span className="botg-head-spacer" />}
                                {owned && (
                                    <button
                                        className={`botg-switch ${on ? 'on' : ''}`}
                                        onClick={() => toggleBotInPreset(bot.name)}
                                        title={on ? 'Running in this preset — tap to turn off' : 'Off in this preset — tap to turn on'}
                                    >
                                        <span className="botg-switch-text">{on ? 'ON' : 'OFF'}</span>
                                        <span className="botg-switch-knob" />
                                    </button>
                                )}
                            </div>

                            {!owned ? (
                                <button className="botg-unlock" onClick={() => setBotOwned(bot.name, true, activePreset)}
                                    title="Mark this bot as unlocked in this preset">
                                    UNLOCK BOT
                                </button>
                            ) : (
                                <>
                                    <div className="botg-stats">
                                        {bot.stats.map((stat, idx) => {
                                            const lv = medals[idx] ?? 0;
                                            const max = stat.values.length;
                                            const maxed = lv >= max;
                                            const shown = lv > 0 ? stat.values[lv - 1] : stat.lv0;
                                            const add = bonuses.find(b => b.mode === 'add' && b.statIdx === idx) as AddBonus | undefined;
                                            const delta = (add ? add.delta(labData[add.labName] ?? 0) : 0)
                                                + (stat.label === 'Range' ? rangeBonus : 0);
                                            return (
                                                <div key={stat.label} className={`botg-stat ${maxed ? 'maxed' : ''}`}>
                                                    <span className="botg-stat-label">{stat.label}</span>
                                                    <span className="botg-stat-value" title={delta ? `Medal level: ${shown}` : undefined}>
                                                        {withDelta(shown, delta)}
                                                    </span>
                                                    <span className="botg-stat-foot">
                                                        <button className="botg-step" disabled={lv <= 0}
                                                            onClick={() => setBotMedal(bot.name, activePreset, idx, lv - 1)}
                                                            title="One medal level down">−</button>
                                                        <span>{maxed ? 'Max' : `Lv ${lv}/${max}`}</span>
                                                        <button className="botg-step" disabled={maxed}
                                                            onClick={() => setBotMedal(bot.name, activePreset, idx, lv + 1)}
                                                            title="One medal level up">+</button>
                                                    </span>
                                                    <button className="botg-stat-max" disabled={maxed}
                                                        onClick={() => setBotMedal(bot.name, activePreset, idx, max)}
                                                        title={maxed ? `${stat.label} is maxed` : `Max ${stat.label} (Lv ${max})`}>
                                                        {maxed ? 'MAXED' : 'MAX'}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {infos.length > 0 && (
                                        <div className="botg-info">{infos.join(' · ')}</div>
                                    )}

                                    {footgun && (
                                        <div className="bot-footgun-warning">
                                            ⚠️ Cooldown ({statValue(1).toFixed(1)}s) ≤ Duration ({statValue(0).toFixed(1)}s) — this bot
                                            stays permanently active. Consider this before leveling further.
                                        </div>
                                    )}

                                    {(plusOwned || allBotsOwned) && (plusOwned ? (
                                        <div className={`botg-plusbox ${plusMaxed ? 'maxed' : ''}`}>
                                            <span className="botg-plusbox-label">Bot+ · {bot.plus.label}</span>
                                            <span className="botg-plusbox-value">
                                                {plusLv > 0 ? bot.plus.values[plusLv - 1] : bot.plus.lv0}
                                            </span>
                                            <span className="botg-plusbox-steps">
                                                <button className="botg-step" disabled={plusLv <= 0}
                                                    onClick={() => setBotPlusLevel(bot.name, activePreset, plusLv - 1)}
                                                    title="One Bot+ level down">−</button>
                                                <span>{plusMaxed ? 'Max' : `Lv ${plusLv}/${bot.plusMax}`}</span>
                                                <button className="botg-step" disabled={plusMaxed}
                                                    onClick={() => setBotPlusLevel(bot.name, activePreset, plusLv + 1)}
                                                    title="One Bot+ level up">+</button>
                                            </span>
                                            <button className="botg-plusbox-max" disabled={plusMaxed}
                                                onClick={() => setBotPlusLevel(bot.name, activePreset, bot.plusMax)}
                                                title={plusMaxed ? `${bot.plus.label} is maxed` : `Max ${bot.plus.label} (Lv ${bot.plusMax})`}>
                                                {plusMaxed ? 'MAXED' : 'MAX'}
                                            </button>
                                        </div>
                                    ) : (
                                        <button className="botg-plus-unlock" onClick={() => setBotPlusOwned(bot.name, true, activePreset)}
                                            title={`Mark ${bot.name}+ as unlocked (${BOT_PLUS_UNLOCK_STONES.toLocaleString()} stones in game)`}>
                                            UNLOCK BOT+ · {bot.plus.label}
                                        </button>
                                    ))}

                                    <div className="botg-foot">
                                        {!allBotsOwned && <span>Bot+ unlocks once all 5 bots are unlocked in this preset</span>}
                                        <span style={{ flex: 1 }} />
                                        <button className="btn btn-dim botg-small" disabled={allMaxed}
                                            onClick={() => {
                                                bot.stats.forEach((stat, idx) => setBotMedal(bot.name, activePreset, idx, stat.values.length));
                                                if (plusOwned) setBotPlusLevel(bot.name, activePreset, bot.plusMax);
                                            }}>
                                            {allMaxed ? '✓ All maxed' : 'Max all'}
                                        </button>
                                        {plusOwned && (
                                            <button className="btn btn-dim botg-small"
                                                onClick={() => setBotPlusOwned(bot.name, false, activePreset)}
                                                title="Mark Bot+ as not unlocked">
                                                Lock Bot+
                                            </button>
                                        )}
                                        <button className="btn btn-dim botg-small"
                                            onClick={() => setBotOwned(bot.name, false, activePreset)}
                                            title="Mark this bot as not unlocked in this preset">
                                            Lock
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
