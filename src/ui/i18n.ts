/**
 * 轻量 i18n：静态字典 + 缺省回退。
 *
 * 不引入 react-i18next：本项目文案量小，其依赖（约 15 KB）不划算。
 */

import type { Language } from '../platform/profile';

export type TextKey = keyof typeof zh;

const zh = {
  'app.title': 'Rummy',
  'app.subtitle': '在线单机版',

  'home.start': '开始对局',
  'home.continue': '继续对局',
  'home.rating': '当前积分',
  'home.tier': '当前段位',
  'home.toNextTier': '距下一段位还差 {n} 分',
  'home.maxTier': '已达最高星级',
  'home.language': '语言',

  'tier.iron': '黑铁',
  'tier.bronze3': '青铜 III',
  'tier.bronze2': '青铜 II',
  'tier.bronze1': '青铜 I',
  'tier.silver3': '白银 III',
  'tier.silver2': '白银 II',
  'tier.silver1': '白银 I',
  'tier.gold3': '黄金 III',
  'tier.gold2': '黄金 II',
  'tier.gold1': '黄金 I',
  'tier.platinum': '铂金',
  'tier.diamond': '钻石',

  'opponent.L0': '初出茅庐的对手',
  'opponent.L1': '初窥门径的对手',
  'opponent.L2': '旗鼓相当的对手',
  'opponent.L3': '日渐老练的对手',
  'opponent.L4': '身经百战的对手',
  'opponent.L5': '久经沙场的传奇',

  'game.round': '第 {n} 轮',
  'game.deck': '牌堆',
  'game.discard': '弃牌堆',
  'game.you': '你',
  'game.opponent': '对手',
  'game.yourTurn': '轮到你',
  'game.opponentTurn': '对手回合',
  'game.thinking': '对手正在思考…',

  'action.draw': '摸牌',
  'action.takeDiscard': '取弃牌',
  'action.meld': '亮牌',
  'action.layOff': '接牌',
  'action.discard': '弃牌',
  'action.undo': '撤回',
  'action.sortBySuit': '按花色',
  'action.sortByRank': '按大小',

  'settings.title': '设置',
  'settings.sound': '音效',
  'settings.surrender': '认输',
  'settings.surrenderConfirmTitle': '认输',
  'settings.surrenderConfirmBody':
    '认输将立即结束本局，你判负并扣除 3 积分。',
  'settings.surrenderConfirm': '确认认输',
  'settings.cancel': '继续对局',
  'common.close': '关闭',
  'common.cancel': '取消',
  'common.confirm': '确认',

  'round.endTitle': '本轮结束',
  'round.reason.handEmptied': '一方出完手牌',
  'round.reason.jokerLock': '王牌卡死',
  'round.reason.noLegalMove': '无合法动作',
  'round.reason.deckExhausted': '牌堆摸空',
  'round.tableScore': '桌面分',
  'round.handScore': '手牌扣分',
  'round.roundScore': '本轮得分',
  'round.total': '本局累计',
  'round.continue': '继续',

  'match.win': '本局胜利',
  'match.lose': '本局失败',
  'match.draw': '平局',
  'match.ratingDelta': '积分变化 {n}',
  'match.newGame': '开始新的一局',

  'joker.chooseTarget': '选择王牌模拟的牌',
  'joker.chooseSuit': '选择王牌模拟的花色',

  'hint.mustDrawFirst': '需要先摸牌',
  'hint.mustMeld': '先亮出包含该牌的组合',
  'hint.notPlayable': '这张牌无法组成组合或接牌',
  'hint.drawnCannotDiscard': '从弃牌堆取的牌本回合不能弃回',
  'hint.jokerCannotDiscard': '不允许弃出王牌',
  'hint.opponentGain': '此牌分值将计入对手',
  'hint.yourDraw': '轮到你了：摸牌，或从弃牌堆中选择一张',

  'save.incompatible': '因版本更新，上一局已结束',
  'save.corrupt': '存档已损坏，上一局已结束',
} as const;

const en: Record<TextKey, string> = {
  'app.title': 'Rummy',
  'app.subtitle': 'Single-player',

  'home.start': 'Start Game',
  'home.continue': 'Continue',
  'home.rating': 'Rating',
  'home.tier': 'Rank',
  'home.toNextTier': '{n} more to next rank',
  'home.maxTier': 'Max star reached',
  'home.language': 'Language',

  'tier.iron': 'Iron',
  'tier.bronze3': 'Bronze III',
  'tier.bronze2': 'Bronze II',
  'tier.bronze1': 'Bronze I',
  'tier.silver3': 'Silver III',
  'tier.silver2': 'Silver II',
  'tier.silver1': 'Silver I',
  'tier.gold3': 'Gold III',
  'tier.gold2': 'Gold II',
  'tier.gold1': 'Gold I',
  'tier.platinum': 'Platinum',
  'tier.diamond': 'Diamond',

  'opponent.L0': 'A greenhorn opponent',
  'opponent.L1': 'A promising opponent',
  'opponent.L2': 'An evenly matched opponent',
  'opponent.L3': 'A seasoned opponent',
  'opponent.L4': 'A battle-hardened opponent',
  'opponent.L5': 'A legendary veteran',

  'game.round': 'Round {n}',
  'game.deck': 'Deck',
  'game.discard': 'Discard',
  'game.you': 'You',
  'game.opponent': 'Opponent',
  'game.yourTurn': 'Your turn',
  'game.opponentTurn': 'Opponent turn',
  'game.thinking': 'Opponent is thinking…',

  'action.draw': 'Draw',
  'action.takeDiscard': 'Take discard',
  'action.meld': 'Meld',
  'action.layOff': 'Lay off',
  'action.discard': 'Discard',
  'action.undo': 'Undo',
  'action.sortBySuit': 'By suit',
  'action.sortByRank': 'By rank',

  'settings.title': 'Settings',
  'settings.sound': 'Sound',
  'settings.surrender': 'Surrender',
  'settings.surrenderConfirmTitle': 'Surrender',
  'settings.surrenderConfirmBody':
    'Surrendering ends this game immediately. You lose and drop 3 rating.',
  'settings.surrenderConfirm': 'Surrender',
  'settings.cancel': 'Keep playing',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',

  'round.endTitle': 'Round Over',
  'round.reason.handEmptied': 'A player went out',
  'round.reason.jokerLock': 'Joker lock',
  'round.reason.noLegalMove': 'No legal move',
  'round.reason.deckExhausted': 'Deck exhausted',
  'round.tableScore': 'Table',
  'round.handScore': 'Hand penalty',
  'round.roundScore': 'Round score',
  'round.total': 'Match total',
  'round.continue': 'Continue',

  'match.win': 'You win',
  'match.lose': 'You lose',
  'match.draw': 'Draw',
  'match.ratingDelta': 'Rating {n}',
  'match.newGame': 'Start a new game',

  'joker.chooseTarget': "Choose the card this joker imitates",
  'joker.chooseSuit': 'Choose the suit this joker imitates',

  'hint.mustDrawFirst': 'Draw a card first',
  'hint.mustMeld': 'Meld a set containing that card first',
  'hint.notPlayable': 'This card cannot form a meld or be laid off',
  'hint.drawnCannotDiscard': 'You cannot discard a card taken from the discard pile this turn',
  'hint.jokerCannotDiscard': 'Jokers cannot be discarded',
  'hint.opponentGain': "This card's value goes to your opponent",
  'hint.yourDraw': 'Your turn: draw a card, or pick one from the discard pile',

  'save.incompatible': 'A new version ended your previous game',
  'save.corrupt': 'Save was corrupted; previous game ended',
};

const DICTS: Record<Language, Record<TextKey, string>> = { zh, en };

export function translate(
  language: Language,
  key: TextKey,
  vars?: Record<string, string | number>,
): string {
  const dict = DICTS[language];
  const template = dict[key] ?? DICTS.zh[key] ?? key;
  if (vars === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars[name] ?? `{${name}}`),
  );
}
