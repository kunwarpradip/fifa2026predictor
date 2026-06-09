export function outcome(a, b) {
  if (Number(a) === Number(b)) return 'draw';
  return Number(a) > Number(b) ? 'home' : 'away';
}
export function scorePrediction(prediction, match) {
  if (!match?.resultPublished) return 0;
  const ph = Number(prediction.homeGoals), pa = Number(prediction.awayGoals);
  const rh = Number(match.homeGoals), ra = Number(match.awayGoals);
  if (ph === rh && pa === ra) return 4;
  return outcome(ph, pa) === outcome(rh, ra) ? 2 : 0;
}
