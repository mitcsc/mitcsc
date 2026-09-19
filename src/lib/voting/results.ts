import type { Candidate, Criterion, Ratings } from './types';
export interface ResultBallot { voterId: string; voterName: string; initial: Ratings; final: Ratings; submittedAt: string }
export interface ElectionResults {
  sessionId: string; ended: boolean; spreadsheetUrl: string; voterCount: number;
  criteria: Criterion[];
  candidates: {candidate: Candidate; initialCount: number; ballots: ResultBallot[]; stats: {criterionId: string; count: number; initialAverage: number | null; average: number | null; median: number | null; min: number | null; max: number | null; distribution: {rating: number; count: number}[]}[]}[];
}
export function summarizeRatings(ballots: ResultBallot[], criterionId: string) {
  const values = ballots.map(b => b.final[criterionId]).filter((v): v is number => typeof v === 'number').sort((a,b)=>a-b);
  const initial = ballots.map(b => b.initial[criterionId]).filter((v): v is number => typeof v === 'number');
  const average = (v: number[]) => v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
  return {criterionId, count: values.length, initialAverage: average(initial), average: average(values), median: values.length ? (values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2 : null, min: values[0] ?? null, max: values.at(-1) ?? null, distribution: [...new Set(values)].map(rating=>({rating,count:values.filter(v=>v===rating).length}))};
}
