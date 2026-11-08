import {
  calculatePortfolioPerformance,
  calculateTimeWeightedReturn,
  calculateTWRFromSnapshots,
  computePortfolioFromTrades,
} from '@/lib/analytics/portfolio';

describe('Portfolio Performance & Historical P&L (#3, #21)', () => {
  it('computes realized/unrealized P&L, ROI, and HODL benchmark outperformance', () => {
    const perf = computePortfolioFromTrades(
      [
        { asset: 'XLM', side: 'buy', quantity: 1000, price: 0.1, feeUSD: 0, timestamp: 1000 },
        { asset: 'XLM', side: 'sell', quantity: 500, price: 0.15, feeUSD: 0, timestamp: 2000 },
      ],
      { XLM: 0.2 },
      0.1,
      0.12,
    );

    expect(perf.realizedPnL).toBe(25);
    expect(perf.unrealizedPnL).toBe(50);
    expect(perf.totalPnL).toBe(75);
    expect(perf.benchmark.hodlRoi).toBe(20);
    expect(perf.timeWeightedReturn).toBe(null);
    expect(perf.twrAvailable).toBe(false);
  });

  it('calculates Time-Weighted Return and async wallet summary', async () => {
    expect(calculateTimeWeightedReturn([0.1, 0.1])).toBe(21);
    const res = await calculatePortfolioPerformance('GABC123', new Date('2026-01-01T00:00:00Z'));
    expect(res.positions.length).toBeGreaterThanOrEqual(2);
    expect(res.timeWeightedReturn).toBe(null);
    expect(res.twrAvailable).toBe(false);
  });

  it('calculates compounded TWR from sequential subperiod snapshots', () => {
    // Subperiod 1: 1000 -> 1100 (+10%), Subperiod 2: 1100 -> 1320 (+20%)
    // Compounded TWR = (1.10 * 1.20 - 1) * 100 = 32%
    const snapshots = [
      { timestamp: 1_000, value: 1000 },
      { timestamp: 2_000, value: 1100 },
      { timestamp: 3_000, value: 1320 },
    ];

    expect(calculateTWRFromSnapshots(snapshots)).toBe(32);

    const perf = computePortfolioFromTrades(
      [{ asset: 'XLM', side: 'buy', quantity: 10_000, price: 0.1, timestamp: 1_000 }],
      { XLM: 0.132 },
      0.1,
      0.12,
      snapshots,
    );
    expect(perf.timeWeightedReturn).toBe(32);
    expect(perf.twrAvailable).toBe(true);
  });

  it('calculates TWR independent of net external cash flows at subperiod boundaries', () => {
    // Start with $1000.
    // At t=2000, portfolio grows +10% to $1100, and investor deposits $900 -> ending value $2000 (netCashFlow: +900).
    // At t=3000, portfolio of $2000 grows -5% to $1900, and investor withdraws $400 -> ending value $1500 (netCashFlow: -400).
    // Subperiod 1 return: (2000 - 900 - 1000) / 1000 = +10% (0.10)
    // Subperiod 2 return: (1500 - (-400) - 2000) / 2000 = -5% (-0.05)
    // Compounded TWR: (1.10 * 0.95 - 1) * 100 = 4.5%
    const withCashFlows = [
      { timestamp: 1_000, value: 1000 },
      { timestamp: 2_000, value: 2000, netCashFlow: 900 },
      { timestamp: 3_000, value: 1500, netCashFlow: -400 },
    ];

    const withoutCashFlows = [
      { timestamp: 1_000, value: 1000 },
      { timestamp: 2_000, value: 1100, netCashFlow: 0 },
      { timestamp: 3_000, value: 1045, netCashFlow: 0 },
    ];

    expect(calculateTWRFromSnapshots(withCashFlows)).toBe(4.5);
    expect(calculateTWRFromSnapshots(withoutCashFlows)).toBe(4.5);
  });

  it('represents TWR as unavailable (null) for missing snapshots, single snapshot, or empty input', () => {
    expect(calculateTimeWeightedReturn([])).toBe(0);
    expect(calculateTWRFromSnapshots(undefined)).toBe(null);
    expect(calculateTWRFromSnapshots([])).toBe(null);
    expect(calculateTWRFromSnapshots([{ timestamp: 1_000, value: 1000 }])).toBe(null);
    expect(
      calculateTWRFromSnapshots([
        { timestamp: 1_000, value: 0 },
        { timestamp: 2_000, value: 500 },
      ]),
    ).toBe(null);

    const emptyPerf = computePortfolioFromTrades([], {});
    expect(emptyPerf.timeWeightedReturn).toBe(null);
    expect(emptyPerf.twrAvailable).toBe(false);
  });
});
